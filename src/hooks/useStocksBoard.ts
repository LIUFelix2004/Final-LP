import { useState, useEffect, useRef, useCallback } from 'react';
import type { StockToken, StockPool, StockFeeRow, StockSortWindow } from '../types/stocks';
import { SEED_STOCKS, HOT_MIN_VOLUME_24H, REFRESH_INTERVAL_MS } from '../config/stocks';
import {
  enumerateOfficialTokens,
  loadRegistryCache,
  saveRegistryCache,
  loadUserTokens,
  mergeRegistries,
} from '../services/stocks/registry';
import {
  discoverPoolsForToken,
  buildFeeRow,
  refreshPoolPrices,
  updatePoolsFromPairs,
  loadPoolCache,
  savePoolCache,
} from '../services/stocks/pools';
import { enrichStockPoolFees } from '../services/stocks/poolFees';

export function useStocksBoard() {
  const [registry, setRegistry] = useState<StockToken[]>([]);
  const [feeRows, setFeeRows] = useState<StockFeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState({ current: 0, total: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortWindow, setSortWindow] = useState<StockSortWindow>('h24');
  const [autoRefresh, setAutoRefresh] = useState(() => {
    try { return localStorage.getItem('stocks-auto-refresh') !== 'false'; } catch { return true; }
  });
  const [userAddedSymbols, setUserAddedSymbols] = useState<Set<string>>(new Set());

  const generationRef = useRef(0);
  const poolsRef = useRef<Map<string, StockPool[]>>(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const buildRows = useCallback((tokens: StockToken[], allPools: Map<string, StockPool[]>): StockFeeRow[] => {
    const rows: StockFeeRow[] = [];
    for (const token of tokens) {
      const pools = allPools.get(token.address.toLowerCase()) ?? [];
      if (pools.length === 0 && !userAddedSymbols.has(token.symbol)) continue;
      rows.push(buildFeeRow(token, pools));
    }
    return rows.filter(r =>
      (r.fee.h24 !== null && r.fee.h24 > 0) ||
      (r.pools.some(p => (p.volume.h24 ?? 0) >= HOT_MIN_VOLUME_24H)) ||
      userAddedSymbols.has(r.symbol)
    );
  }, [userAddedSymbols]);

  const refresh = useCallback(async () => {
    const gen = ++generationRef.current;
    try {
      const allPools: StockPool[] = [];
      for (const pools of poolsRef.current.values()) {
        allPools.push(...pools);
      }
      if (allPools.length === 0) return;

      const pairMap = await refreshPoolPrices(allPools);
      if (gen !== generationRef.current) return;

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
    const gen = ++generationRef.current;
    let cancelled = false;

    async function init() {
      setLoading(true);
      setErrors([]);

      let tokens: StockToken[];
      const cached = loadRegistryCache();
      if (cached && cached.length > 0) {
        tokens = cached;
      } else {
        try {
          tokens = await enumerateOfficialTokens();
          saveRegistryCache(tokens);
        } catch {
          tokens = SEED_STOCKS;
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

        for (let i = 0; i < prioritized.length; i++) {
          if (cancelled || gen !== generationRef.current) return;
          const token = prioritized[i];
          setDiscoveryProgress({ current: i + 1, total: prioritized.length });
          try {
            const pools = await discoverPoolsForToken(token);
            if (cancelled) return;
            if (pools.length > 0) {
              const enriched = await enrichStockPoolFees(pools);
              poolsRef.current.set(token.address.toLowerCase(), enriched);

              poolCache.set(token.address.toLowerCase(), {
                tokenAddress: token.address,
                pools: enriched,
                timestamp: Date.now(),
              });
            }
          } catch { /* skip this token */ }

          if (i % 5 === 4 || i === prioritized.length - 1) {
            const rows = buildRows(tokens, poolsRef.current);
            setFeeRows(rows);
            if (loading) { setLoading(false); setLastUpdate(new Date()); }
          }

          if (i < prioritized.length - 1) {
            await new Promise(r => setTimeout(r, 200));
          }
        }

        savePoolCache(poolCache);
        setDiscovering(false);
        if (loading) setLoading(false);
        setLastUpdate(new Date());
      } else {
        setLoading(false);
      }
    }

    init();
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

  const addSymbol = useCallback((symbol: string) => {
    setUserAddedSymbols(prev => new Set(prev).add(symbol.toUpperCase()));
  }, []);

  const sortedRows = [...feeRows].sort((a, b) => {
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
    return (getVal(b) ?? -1) - (getVal(a) ?? -1);
  });

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
    registry,
  };
}
