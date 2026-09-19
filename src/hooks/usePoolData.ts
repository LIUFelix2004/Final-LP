import { useState, useEffect, useCallback, useRef } from 'react';
import type { PoolData, SortField, SortDirection } from '../types';
import { fetchTopPools } from '../services/dexscreener';
import { enrichV3FeeRates } from '../services/onchain';

const REFRESH_INTERVAL = 30_000;

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export function usePoolData(chainId: number) {
  const [pools, setPools] = useState<PoolData[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('feeUsd');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [minTvl, setMinTvl] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isManualRefresh = useRef(false);
  const poolsRef = useRef<PoolData[]>([]);

  const fetchData = useCallback(async (manual = false) => {
    isManualRefresh.current = manual;
    const hadPreviousData = poolsRef.current.length > 0;

    // Only show full loading spinner on first load or manual refresh with no data
    if (!hadPreviousData) {
      setStatus('loading');
    }

    try {
      const result = await fetchTopPools(chainId);

      // Enrich V3/V4 fee rates from on-chain RPC
      let enriched: PoolData[];
      try {
        enriched = await enrichV3FeeRates(result.pools, chainId);
      } catch {
        enriched = result.pools;
      }

      poolsRef.current = enriched;
      setPools(enriched);
      setLastUpdate(new Date());
      setStatus('success');
      setWarnings(result.errors);

      if (enriched.length === 0 && result.errors.length === 0) {
        setError(null);
      } else if (result.partial) {
        setError(null);
        // Warnings are shown separately
      } else {
        setError(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch data';

      if (hadPreviousData && !manual) {
        // Stale-while-revalidate: keep old data, show warning
        setWarnings([`刷新失败: ${msg} (showing stale data)`]);
        setStatus('success');
      } else {
        // No previous data or manual refresh: show full error
        setError(msg);
        setStatus('error');
        if (manual) {
          poolsRef.current = [];
          setPools([]);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  useEffect(() => {
    poolsRef.current = [];
    setPools([]);
    setError(null);
    setWarnings([]);
    setStatus('loading');
    fetchData(false);

    intervalRef.current = setInterval(() => fetchData(false), REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
        return prev;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  const sortedPools = [...pools]
    .filter((p) => (minTvl > 0 && p.tvlUsd !== null ? p.tvlUsd >= minTvl : true))
    .sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });

  return {
    pools: sortedPools,
    loading: status === 'loading',
    error,
    warnings,
    lastUpdate,
    sortField,
    sortDir,
    handleSort,
    minTvl,
    setMinTvl,
    refresh: () => fetchData(true),
    totalCount: pools.length,
    isEmpty: status === 'success' && pools.length === 0,
  };
}
