import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { StockToken, StockPool, StockFeeRow, StockSortWindow } from '../types/stocks';
import { SEED_STOCKS, HOT_MIN_VOLUME_24H, REFRESH_INTERVAL_MS } from '../config/stocks';
import {
  enumerateOfficialTokens,
  loadRegistryCache,
  saveRegistryCache,
  loadUserTokens,
  mergeRegistries,
  removeUserToken,
  saveUserToken,
  loadSnapshotTokens,
  scanNewTokens,
  getSnapshotTokenCount,
} from '../services/stocks/registry';
import {
  discoverPoolsForToken,
  discoverPoolsBatch,
  buildFeeRow,
  refreshPoolPrices,
  updatePoolsFromPairs,
  loadPoolCache,
  savePoolCache,
} from '../services/stocks/pools';
import { enrichStockPoolFees } from '../services/stocks/poolFees';
import { recordSample, enrichRowsWithSampled } from '../services/stocks/feeSampler';

export const RETRY_DELAYS = [60_000, 120_000, 300_000];

export function scheduleRetries(
  delays: number[],
  onRetry: () => void,
): { cancel: () => void } {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (attempt >= delays.length) return;
    timer = setTimeout(() => {
      attempt++;
      onRetry();
      schedule();
    }, delays[attempt]);
  }

  schedule();

  return {
    cancel: () => { if (timer) clearTimeout(timer); },
  };
}

export function mergePoolsPreservingEnriched(
  existing: Map<string, StockPool[]>,
  incoming: Map<string, StockPool[]>,
): void {
  for (const [addr, newPools] of incoming) {
    const current = existing.get(addr);
    if (!current) {
      existing.set(addr, newPools);
      continue;
    }
    const enrichedMap = new Map<string, StockPool>();
    for (const p of current) {
      if (p.feeRate !== null && !p.feeRateInferred) enrichedMap.set(p.pairAddress, p);
    }
    existing.set(addr, newPools.map(p => enrichedMap.get(p.pairAddress) ?? p));
  }
}

export function useStocksBoard() {
  const [registry, setRegistry] = useState<StockToken[]>([]);
  const [feeRows, setFeeRows] = useState<StockFeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState({ current: 0, total: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortWindow, setSortWindow] = useState<StockSortWindow>(() => {
    try {
      const saved = localStorage.getItem('stocks-sort-window-v1');
      if (saved && ['m5', 'h1', 'h24', 'm30', 'h48', 'h72', 'd7'].includes(saved)) return saved as StockSortWindow;
    } catch {}
    return 'h24';
  });
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try { return localStorage.getItem('stocks-auto-refresh') !== 'false'; } catch { return true; }
  });
  const [registryDegraded, setRegistryDegraded] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [userAddedSymbols, setUserAddedSymbols] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('stocks-user-symbols-v1');
      if (saved) { const arr = JSON.parse(saved); if (Array.isArray(arr)) return new Set(arr); }
    } catch {}
    return new Set();
  });

  const discoveryGenRef = useRef(0);
  const refreshGenRef = useRef(0);
  const poolsRef = useRef<Map<string, StockPool[]>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userAddedSymbolsRef = useRef(userAddedSymbols);
  const retryHandleRef = useRef<{ cancel: () => void } | null>(null);
  const feeRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setRetryAttempt] = useState(0);
  const discoveringRef = useRef(false);

  useEffect(() => {
    userAddedSymbolsRef.current = userAddedSymbols;
  }, [userAddedSymbols]);

  const buildRows = useCallback((
    tokens: StockToken[],
    allPools: Map<string, StockPool[]>,
    opts?: { showPlaceholders?: boolean },
  ): StockFeeRow[] => {
    const currentSymbols = userAddedSymbolsRef.current;
    const showPlaceholders = opts?.showPlaceholders ?? false;
    const rows: StockFeeRow[] = [];
    for (const token of tokens) {
      const pools = allPools.get(token.address.toLowerCase()) ?? [];
      if (pools.length === 0 && !currentSymbols.has(token.symbol) && !showPlaceholders) continue;
      rows.push(buildFeeRow(token, pools));
    }
    if (showPlaceholders) return rows;
    return rows.filter(r =>
      (r.fee.h24 !== null && r.fee.h24 > 0) ||
      (r.pools.some(p => (p.volume.h24 ?? 0) >= HOT_MIN_VOLUME_24H)) ||
      currentSymbols.has(r.symbol)
    );
  }, []);

  const feeRetryCountRef = useRef(0);
  const scheduleNullFeeRetryRef = useRef<(tokens: StockToken[]) => void>(() => {});

  useEffect(() => {
    const FEE_RETRY_DELAYS = [10_000, 30_000, 60_000];
    const LOW_FREQ_RETRY_MS = 300_000;
    scheduleNullFeeRetryRef.current = (currentTokens: StockToken[]) => {
      if (feeRetryRef.current) clearTimeout(feeRetryRef.current);
      const needsFeePools: StockPool[] = [];
      for (const pools of poolsRef.current.values()) {
        needsFeePools.push(...pools.filter(p => (p.feeRate === null || p.feeRateInferred) && !p.feeRateUnreadable));
      }
      if (needsFeePools.length === 0) return;
      const delay = feeRetryCountRef.current < FEE_RETRY_DELAYS.length
        ? FEE_RETRY_DELAYS[feeRetryCountRef.current]
        : LOW_FREQ_RETRY_MS;
      feeRetryRef.current = setTimeout(async () => {
        feeRetryCountRef.current++;
        try {
          const enriched = await enrichStockPoolFees(needsFeePools);
          const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
          let changed = false;
          for (const [addr, pools] of poolsRef.current) {
            const updated = pools.map(p => {
              const e = enrichedMap.get(p.pairAddress);
              if (e && e.feeRate !== null && !e.feeRateInferred && (p.feeRate === null || p.feeRateInferred)) { changed = true; return e; }
              return p;
            });
            poolsRef.current.set(addr, updated);
          }
          if (changed) {
            feeRetryCountRef.current = 0;
            const pc = loadPoolCache();
            for (const [addr, pools] of poolsRef.current) {
              const t = currentTokens.find(tok => tok.address.toLowerCase() === addr);
              if (t) pc.set(addr, { tokenAddress: t.address, pools, timestamp: Date.now() });
            }
            savePoolCache(pc);
            setFeeRows(buildRows(currentTokens, poolsRef.current));
          }
        } catch { /* fee retry failed */ }
        scheduleNullFeeRetryRef.current(currentTokens);
      }, delay);
    };
  });

  const refresh = useCallback(async () => {
    const gen = ++refreshGenRef.current;
    try {
      const allPools: StockPool[] = [];
      for (const pools of poolsRef.current.values()) {
        allPools.push(...pools);
      }
      if (allPools.length === 0) return;

      const pairMap = await refreshPoolPrices(allPools);
      if (gen !== refreshGenRef.current) return;

      for (const [addr, pools] of poolsRef.current) {
        const token = registry.find(t => t.address.toLowerCase() === addr);
        if (token) {
          poolsRef.current.set(addr, updatePoolsFromPairs(pools, pairMap, token.address));
        }
      }

      const rows = buildRows(registry, poolsRef.current);
      setFeeRows(rows);
      setLastUpdate(new Date());
    } catch (err) {
      setErrors(prev => [...prev.slice(-2), `刷新失败: ${err instanceof Error ? err.message : String(err)}`]);
    }
  }, [registry, buildRows]);

  useEffect(() => {
    const gen = ++discoveryGenRef.current;
    let cancelled = false;

    async function init() {
      setLoading(true);
      setErrors([]);

      let tokens: StockToken[];
      const cached = loadRegistryCache();
      if (cached && cached.length > 0) {
        tokens = cached;
      } else {
        tokens = loadSnapshotTokens();
      }
      if (cancelled) return;

      const userTokens = loadUserTokens();
      tokens = mergeRegistries(tokens, userTokens);
      setRegistry(tokens);

      const poolCache = loadPoolCache();
      const needsDiscovery: StockToken[] = [];

      for (const token of tokens) {
        const cached2 = poolCache.get(token.address.toLowerCase());
        if (cached2) {
          poolsRef.current.set(token.address.toLowerCase(), cached2.pools);
        } else {
          needsDiscovery.push(token);
        }
      }

      if (poolsRef.current.size > 0) {
        const rows = buildRows(tokens, poolsRef.current);
        setFeeRows(rows);
        setLoading(false);
        setLastUpdate(new Date());

        let allNeedFees: StockPool[] = [];
        for (const pools of poolsRef.current.values()) {
          allNeedFees.push(...pools.filter(p => p.feeRate === null && !p.feeRateUnreadable));
        }
        if (allNeedFees.length > 0) {
          try {
            const enriched = await enrichStockPoolFees(allNeedFees);
            const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
            let feeChanged = false;
            for (const [addr, pools] of poolsRef.current) {
              const updated = pools.map(p => {
                const e = enrichedMap.get(p.pairAddress);
                if (e && e.feeRate !== null && (p.feeRate === null || p.feeRate !== e.feeRate)) { feeChanged = true; return e; }
                return p;
              });
              poolsRef.current.set(addr, updated);
            }
            if (feeChanged) {
              setFeeRows(buildRows(tokens, poolsRef.current));
              setLastUpdate(new Date());
            }
          } catch { /* background fee enrichment failed */ }
        }
      }

      // N5: render placeholder rows immediately when discovery needed
      if (poolsRef.current.size === 0 && needsDiscovery.length > 0) {
        setFeeRows(buildRows(tokens, poolsRef.current, { showPlaceholders: true }));
        setLoading(false);
      }

      if (needsDiscovery.length > 0) {
        setDiscovering(true);
        discoveringRef.current = true;
        setDiscoveryProgress({ current: 0, total: needsDiscovery.length });

        const seedAddrs = new Set(SEED_STOCKS.map(s => s.address.toLowerCase()));
        const prioritized = [
          ...needsDiscovery.filter(t => seedAddrs.has(t.address.toLowerCase())),
          ...needsDiscovery.filter(t => !seedAddrs.has(t.address.toLowerCase())),
        ];

        const abortController = new AbortController();
        let lastBatchSize = 0;
        await discoverPoolsBatch(
          prioritized,
          abortController.signal,
          (current, total) => {
            if (!cancelled && gen === discoveryGenRef.current) {
              setDiscoveryProgress({ current, total });
            }
          },
          async (cumulativeResults) => {
            if (cancelled || gen !== discoveryGenRef.current) return;

            const newInBatch: StockPool[] = [];
            for (const [addr, pools] of cumulativeResults) {
              const existing = poolsRef.current.get(addr);
              if (!existing) {
                poolsRef.current.set(addr, pools);
                newInBatch.push(...pools.filter(p => p.feeRate === null));
              }
            }

            if (newInBatch.length > 0) {
              try {
                const enriched = await enrichStockPoolFees(newInBatch);
                const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
                for (const [addr, pools] of poolsRef.current) {
                  poolsRef.current.set(addr, pools.map(p => enrichedMap.get(p.pairAddress) ?? p));
                }
              } catch { /* fee enrichment failed for batch, continue */ }
              scheduleNullFeeRetryRef.current(tokens);
            } else {
              scheduleNullFeeRetryRef.current(tokens);
            }

            if (cumulativeResults.size > lastBatchSize) {
              lastBatchSize = cumulativeResults.size;
              const pc = loadPoolCache();
              for (const [addr, _pools] of cumulativeResults) {
                const enrichedPools = poolsRef.current.get(addr) ?? _pools;
                pc.set(addr, {
                  tokenAddress: tokens.find(t => t.address.toLowerCase() === addr)?.address ?? addr,
                  pools: enrichedPools,
                  timestamp: Date.now(),
                });
              }
              savePoolCache(pc);
            }

            // N5: during discovery, include placeholder rows for undiscovered tokens
            const rows = buildRows(tokens, poolsRef.current, { showPlaceholders: true });
            setFeeRows(rows);
            setLastUpdate(new Date());
          },
        );

        if (cancelled || gen !== discoveryGenRef.current) return;

        const finalCache = loadPoolCache();
        for (const [addr] of poolsRef.current) {
          const enrichedPools = poolsRef.current.get(addr)!;
          finalCache.set(addr, {
            tokenAddress: tokens.find(t => t.address.toLowerCase() === addr)?.address ?? addr,
            pools: enrichedPools,
            timestamp: Date.now(),
          });
        }
        savePoolCache(finalCache);

        // Discovery done: now filter with normal rules (no placeholders)
        const rows = buildRows(tokens, poolsRef.current);
        setFeeRows(rows);

        setDiscovering(false);
        discoveringRef.current = false;
        feeRetryCountRef.current = 0;
        setLastUpdate(new Date());
        scheduleNullFeeRetryRef.current(tokens);
      } else if (loading) {
        setLoading(false);
      }

      if (cancelled) return;
      // Background registry scan for new tokens
      if (!cached) {
        try {
          const knownAddrs = new Set(tokens.map(t => t.address.toLowerCase()));
          const newTokens = await scanNewTokens(knownAddrs);
          if (cancelled) return;
          if (newTokens.length > 0) {
            tokens = mergeRegistries(tokens, newTokens);
            setRegistry(tokens);
            saveRegistryCache(tokens);

            const newNeedDiscovery = newTokens.filter(t => !poolsRef.current.has(t.address.toLowerCase()));
            if (newNeedDiscovery.length > 0) {
              const newResults = await discoverPoolsBatch(newNeedDiscovery);
              if (cancelled) return;

              mergePoolsPreservingEnriched(poolsRef.current, newResults);
              let needFees: StockPool[] = [];
              for (const [addr] of newResults) {
                const pools = poolsRef.current.get(addr);
                if (pools) needFees.push(...pools.filter(p => p.feeRate === null));
              }
              if (needFees.length > 0) {
                try {
                  const enriched = await enrichStockPoolFees(needFees);
                  const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
                  for (const [addr, pools] of poolsRef.current) {
                    poolsRef.current.set(addr, pools.map(p => enrichedMap.get(p.pairAddress) ?? p));
                  }
                } catch { /* enrichment failed */ }
              }

              const pc = loadPoolCache();
              for (const [addr] of newResults) {
                const pools = poolsRef.current.get(addr) ?? [];
                pc.set(addr, { tokenAddress: newTokens.find(t => t.address.toLowerCase() === addr)?.address ?? addr, pools, timestamp: Date.now() });
              }
              savePoolCache(pc);
              setFeeRows(buildRows(tokens, poolsRef.current));
              setLastUpdate(new Date());
            }
          } else {
            saveRegistryCache(tokens);
          }
        } catch (err) {
          console.warn('[registry] background scan failed:', err instanceof Error ? err.message : String(err));
          // N2: only show degraded if snapshot is small (not the full 200+ token snapshot)
          const snapCount = getSnapshotTokenCount();
          if (snapCount < 100) {
            setRegistryDegraded(true);
          }
        }
      }
    }

    init().catch(() => {
      setDiscovering(false);
      discoveringRef.current = false;
      setLoading(false);
    });
    return () => {
      cancelled = true;
      if (feeRetryRef.current) clearTimeout(feeRetryRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoRefresh && feeRows.length > 0) {
      intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, refresh, feeRows.length]);

  useEffect(() => {
    try { localStorage.setItem('stocks-auto-refresh', String(autoRefresh)); } catch {}
  }, [autoRefresh]);

  useEffect(() => {
    try { localStorage.setItem('stocks-sort-window-v1', sortWindow); } catch {}
  }, [sortWindow]);

  useEffect(() => {
    if (poolsRef.current.size > 0 && registry.length > 0) {
      const rows = buildRows(registry, poolsRef.current);
      setFeeRows(rows);
    }
  }, [userAddedSymbols]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryRegistry = useCallback(async () => {
    setRetryLoading(true);
    try {
      const result = await enumerateOfficialTokens();
      if (!result.degraded) {
        setRegistryDegraded(false);
        setRetryAttempt(0);
        const userTokens = loadUserTokens();
        const merged = mergeRegistries(result.tokens, userTokens);
        setRegistry(merged);
        saveRegistryCache(result.tokens);

        const newTokens = merged.filter(t => !poolsRef.current.has(t.address.toLowerCase()));
        if (newTokens.length > 0) {
          const batchResults = await discoverPoolsBatch(newTokens);
          const poolCache = loadPoolCache();

          mergePoolsPreservingEnriched(poolsRef.current, batchResults);
          let allNeedFees: StockPool[] = [];
          for (const [addr] of batchResults) {
            const pools = poolsRef.current.get(addr);
            if (pools) allNeedFees.push(...pools.filter(p => p.feeRate === null));
          }

          if (allNeedFees.length > 0) {
            const enriched = await enrichStockPoolFees(allNeedFees);
            const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
            for (const [addr, pools] of poolsRef.current) {
              poolsRef.current.set(addr, pools.map(p => enrichedMap.get(p.pairAddress) ?? p));
            }
          }

          for (const [addr] of batchResults) {
            const pools = poolsRef.current.get(addr) ?? [];
            poolCache.set(addr, { tokenAddress: newTokens.find(t => t.address.toLowerCase() === addr)?.address ?? addr, pools, timestamp: Date.now() });
          }
          savePoolCache(poolCache);
        }
        const rows = buildRows(merged, poolsRef.current);
        setFeeRows(rows);
        setLastUpdate(new Date());
      }
    } finally {
      setRetryLoading(false);
    }
  }, [buildRows]);

  // N6: use scheduleRetries for retry logic
  useEffect(() => {
    if (retryHandleRef.current) {
      retryHandleRef.current.cancel();
      retryHandleRef.current = null;
    }
    if (!registryDegraded) {
      setRetryAttempt(0);
      return;
    }
    retryHandleRef.current = scheduleRetries(RETRY_DELAYS, () => {
      setRetryAttempt(prev => prev + 1);
      retryRegistry().catch(() => {});
    });
    return () => {
      if (retryHandleRef.current) {
        retryHandleRef.current.cancel();
        retryHandleRef.current = null;
      }
    };
  }, [registryDegraded, retryRegistry]);

  const addSymbol = useCallback((symbol: string) => {
    setUserAddedSymbols(prev => {
      const next = new Set(prev).add(symbol.toUpperCase());
      try { localStorage.setItem('stocks-user-symbols-v1', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const discoverAndAddSymbol = useCallback(async (token: StockToken) => {
    addSymbol(token.symbol);
    saveUserToken(token);

    setRegistry(prev => {
      if (prev.some(t => t.address.toLowerCase() === token.address.toLowerCase())) return prev;
      return [...prev, token];
    });

    const addr = token.address.toLowerCase();
    const existing = poolsRef.current.get(addr);
    if (existing && existing.length > 0) {
      setFeeRows(buildRows([...registry, token], poolsRef.current));
      return;
    }

    try {
      const pools = await discoverPoolsForToken(token);
      const enriched = pools.length > 0 ? await enrichStockPoolFees(pools) : [];
      poolsRef.current.set(addr, enriched);

      const poolCache = loadPoolCache();
      poolCache.set(addr, { tokenAddress: token.address, pools: enriched, timestamp: Date.now() });
      savePoolCache(poolCache);

      setFeeRows(buildRows([...registry, token], poolsRef.current));
    } catch {}
  }, [addSymbol, registry, buildRows]);

  const removeSymbol = useCallback((symbol: string, address: string) => {
    removeUserToken(address);
    poolsRef.current.delete(address.toLowerCase());
    setRegistry(prev => prev.filter(t => t.address.toLowerCase() !== address.toLowerCase()));
    setFeeRows(prev => prev.filter(r => r.address.toLowerCase() !== address.toLowerCase()));
    setUserAddedSymbols(prev => {
      const next = new Set(prev);
      next.delete(symbol.toUpperCase());
      try { localStorage.setItem('stocks-user-symbols-v1', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const mergeResolvedPools = useCallback((resolved: import('../types/stocks').StockPool[]) => {
    if (resolved.length === 0) return;
    const resolvedMap = new Map(resolved.map(p => [p.pairAddress, p]));
    let changed = false;
    for (const [addr, pools] of poolsRef.current) {
      let tokenChanged = false;
      const updated = pools.map(p => {
        const r = resolvedMap.get(p.pairAddress);
        if (r && r.feeRate !== null && !r.feeRateInferred && (p.feeRate !== r.feeRate || p.feeRateInferred)) {
          tokenChanged = true;
          return r;
        }
        return p;
      });
      if (tokenChanged) {
        changed = true;
        poolsRef.current.set(addr, updated);
      }
    }
    if (changed) {
      const pc = loadPoolCache();
      for (const [addr, pools] of poolsRef.current) {
        const t = registry.find(tok => tok.address.toLowerCase() === addr);
        if (t) pc.set(addr, { tokenAddress: t.address, pools, timestamp: Date.now() });
      }
      savePoolCache(pc);
      setFeeRows(buildRows(registry, poolsRef.current));
    }
  }, [registry, buildRows]);

  const [samplerVersion, setSamplerVersion] = useState(0);

  useEffect(() => {
    if (feeRows.length > 0) {
      recordSample(feeRows);
      setSamplerVersion(v => v + 1);
    }
  }, [feeRows]);

  const sortedRows = useMemo(() => {
    const enriched = feeRows.length > 0 ? enrichRowsWithSampled(feeRows) : feeRows;
    const getVal = (row: StockFeeRow): number | null => {
      switch (sortWindow) {
        case 'm5': return row.fee.m5;
        case 'h1': return row.fee.h1;
        case 'h24': return row.fee.h24;
        case 'm30': return row.sampled?.m30 ?? null;
        case 'h48': return row.sampled?.h48 ?? null;
        case 'h72': return row.sampled?.h72 ?? null;
        case 'd7': return row.sampled?.d7 ?? null;
        default: return row.fee.h24;
      }
    };
    return [...enriched].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va === null && vb === null) return (b.fee.h24 ?? -1) - (a.fee.h24 ?? -1);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (vb !== va) return vb - va;
      return (b.fee.h24 ?? -1) - (a.fee.h24 ?? -1);
    });
  }, [feeRows, sortWindow, samplerVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    rows: sortedRows,
    loading,
    discovering,
    discoveryProgress,
    errors,
    lastUpdate,
    sortWindow,
    setSortWindow,
    autoRefresh,
    setAutoRefresh,
    refresh,
    addSymbol,
    discoverAndAddSymbol,
    removeSymbol,
    registry,
    userAddedSymbols,
    registryDegraded,
    retryRegistry,
    retryLoading,
    mergeResolvedPools,
  };
}
