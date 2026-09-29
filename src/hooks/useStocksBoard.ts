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
  type RegistryResult,
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

const RETRY_DELAYS = [60_000, 120_000, 300_000];

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
  const retryAttemptRef = useRef(0);

  // M4: keep ref in sync so buildRows always sees latest
  useEffect(() => {
    userAddedSymbolsRef.current = userAddedSymbols;
  }, [userAddedSymbols]);

  const buildRows = useCallback((tokens: StockToken[], allPools: Map<string, StockPool[]>): StockFeeRow[] => {
    const currentSymbols = userAddedSymbolsRef.current;
    const rows: StockFeeRow[] = [];
    for (const token of tokens) {
      const pools = allPools.get(token.address.toLowerCase()) ?? [];
      if (pools.length === 0 && !currentSymbols.has(token.symbol)) continue;
      rows.push(buildFeeRow(token, pools));
    }
    return rows.filter(r =>
      (r.fee.h24 !== null && r.fee.h24 > 0) ||
      (r.pools.some(p => (p.volume.h24 ?? 0) >= HOT_MIN_VOLUME_24H)) ||
      currentSymbols.has(r.symbol)
    );
  }, []);

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
        const result: RegistryResult = await enumerateOfficialTokens();
        tokens = result.tokens;
        if (result.degraded) {
          setRegistryDegraded(true);
        } else {
          saveRegistryCache(tokens);
        }
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
        let allNeedFees: StockPool[] = [];
        for (const pools of poolsRef.current.values()) {
          allNeedFees.push(...pools.filter(p => p.feeRate === null));
        }
        if (allNeedFees.length > 0) {
          const enriched = await enrichStockPoolFees(allNeedFees);
          const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
          for (const [addr, pools] of poolsRef.current) {
            poolsRef.current.set(addr, pools.map(p => enrichedMap.get(p.pairAddress) ?? p));
          }
        }

        const rows = buildRows(tokens, poolsRef.current);
        setFeeRows(rows);
        setLoading(false);
        setLastUpdate(new Date());
      }

      if (needsDiscovery.length > 0) {
        setDiscovering(true);
        setDiscoveryProgress({ current: 0, total: needsDiscovery.length });

        const seedAddrs = new Set(SEED_STOCKS.map(s => s.address.toLowerCase()));
        const prioritized = [
          ...needsDiscovery.filter(t => seedAddrs.has(t.address.toLowerCase())),
          ...needsDiscovery.filter(t => !seedAddrs.has(t.address.toLowerCase())),
        ];

        const abortController = new AbortController();
        const batchResults = await discoverPoolsBatch(
          prioritized,
          abortController.signal,
          (current, total) => {
            if (!cancelled && gen === discoveryGenRef.current) {
              setDiscoveryProgress({ current, total });
            }
          },
          // M1: Progressive row rebuild after each batch completes
          (partialResults) => {
            if (cancelled || gen !== discoveryGenRef.current) return;
            for (const [addr, pools] of partialResults) {
              poolsRef.current.set(addr, pools);
            }
            const rows = buildRows(tokens, poolsRef.current);
            setFeeRows(rows);
            if (loading) setLoading(false);
            setLastUpdate(new Date());
          },
        );

        if (cancelled || gen !== discoveryGenRef.current) return;

        let allNeedFees: StockPool[] = [];
        for (const [addr, pools] of batchResults) {
          poolsRef.current.set(addr, pools);
          allNeedFees.push(...pools.filter(p => p.feeRate === null));
          poolCache.set(addr, { tokenAddress: tokens.find(t => t.address.toLowerCase() === addr)?.address ?? addr, pools, timestamp: Date.now() });
        }

        if (allNeedFees.length > 0 && !cancelled) {
          const enriched = await enrichStockPoolFees(allNeedFees);
          const enrichedMap = new Map(enriched.map(p => [p.pairAddress, p]));
          for (const [addr, pools] of poolsRef.current) {
            poolsRef.current.set(addr, pools.map(p => enrichedMap.get(p.pairAddress) ?? p));
          }
        }

        savePoolCache(poolCache);
        const rows = buildRows(tokens, poolsRef.current);
        setFeeRows(rows);

        setDiscovering(false);
        if (loading) setLoading(false);
        setLastUpdate(new Date());
      } else {
        setLoading(false);
      }
    }

    init().catch(() => {
      setDiscovering(false);
      setLoading(false);
    });
    return () => { cancelled = true; };
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

  // M5: retryRegistry discovers pools + rebuilds rows
  const retryRegistry = useCallback(async () => {
    setRetryLoading(true);
    try {
      const result = await enumerateOfficialTokens();
      if (!result.degraded) {
        setRegistryDegraded(false);
        retryAttemptRef.current = 0;
        const userTokens = loadUserTokens();
        const merged = mergeRegistries(result.tokens, userTokens);
        setRegistry(merged);
        saveRegistryCache(result.tokens);

        // Discover pools for any new tokens
        const newTokens = merged.filter(t => !poolsRef.current.has(t.address.toLowerCase()));
        if (newTokens.length > 0) {
          const batchResults = await discoverPoolsBatch(newTokens);
          const poolCache = loadPoolCache();
          for (const [addr, pools] of batchResults) {
            poolsRef.current.set(addr, pools);
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

  // M5: Escalating auto-retry (60s / 120s / 300s)
  useEffect(() => {
    if (!registryDegraded) {
      retryAttemptRef.current = 0;
      return;
    }
    const attempt = retryAttemptRef.current;
    if (attempt >= RETRY_DELAYS.length) return;
    const delay = RETRY_DELAYS[attempt];
    const timer = setTimeout(() => {
      retryAttemptRef.current = attempt + 1;
      retryRegistry().catch(() => {});
    }, delay);
    return () => clearTimeout(timer);
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

    const addr = token.address.toLowerCase();
    const existing = poolsRef.current.get(addr);
    if (existing && existing.length > 0) {
      // M4: rebuild with latest ref immediately
      setFeeRows(buildRows(registry, poolsRef.current));
      return;
    }

    try {
      const pools = await discoverPoolsForToken(token);
      const enriched = pools.length > 0 ? await enrichStockPoolFees(pools) : [];
      poolsRef.current.set(addr, enriched);

      const poolCache = loadPoolCache();
      poolCache.set(addr, { tokenAddress: token.address, pools: enriched, timestamp: Date.now() });
      savePoolCache(poolCache);

      setFeeRows(buildRows(registry, poolsRef.current));
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
  };
}
