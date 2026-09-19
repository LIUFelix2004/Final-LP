import { useState, useEffect, useCallback, useRef } from 'react';
import type { PoolData, SortField, SortDirection } from '../types';
import { fetchTopPools } from '../services/dexscreener';

const REFRESH_INTERVAL = 30_000; // 30s

export function usePoolData(chainId: number) {
  const [pools, setPools] = useState<PoolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('feeUsd');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [minTvl, setMinTvl] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchTopPools(chainId);
      setPools(data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => {
    setLoading(true);
    setPools([]);
    fetchData();

    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
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
    loading,
    error,
    lastUpdate,
    sortField,
    sortDir,
    handleSort,
    minTvl,
    setMinTvl,
    refresh: fetchData,
    totalCount: pools.length,
  };
}
