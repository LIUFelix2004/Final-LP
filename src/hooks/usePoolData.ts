import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { PoolData, SortField, SortDirection, TimeWindow } from '../types';
import { fetchTopPools } from '../services/dexscreener';
import { enrichV3FeeRates } from '../services/onchain';
import { VolumeSampler } from '../services/sampler';
import { applyTimeWindow } from '../utils/windowCalc';

const REFRESH_INTERVAL = 30_000;

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export function usePoolData(chainId: number, onRefreshComplete?: (pools: PoolData[]) => void) {
  const [rawPools, setRawPools] = useState<PoolData[]>([]);
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('feeUsd');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [minTvl, setMinTvl] = useState<number>(0);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('h24');
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isManualRefresh = useRef(false);
  const poolsRef = useRef<PoolData[]>([]);
  const samplerRef = useRef(new VolumeSampler());
  const onRefreshRef = useRef(onRefreshComplete);
  onRefreshRef.current = onRefreshComplete;

  const fetchData = useCallback(async (manual = false) => {
    isManualRefresh.current = manual;
    const hadPreviousData = poolsRef.current.length > 0;

    if (!hadPreviousData) {
      setStatus('loading');
    }

    try {
      const result = await fetchTopPools(chainId);

      let enriched: PoolData[];
      try {
        enriched = await enrichV3FeeRates(result.pools, chainId);
      } catch {
        enriched = result.pools;
      }

      samplerRef.current.recordBatch(
        enriched
          .filter((p) => p.windows.m5.volume !== null)
          .map((p) => ({
            pairAddress: p.pairAddress,
            chainId: p.chainId,
            volM5: p.windows.m5.volume as number,
          })),
      );

      poolsRef.current = enriched;
      setRawPools(enriched);
      setLastUpdate(new Date());
      setStatus('success');
      setWarnings(result.errors);
      setError(null);
      onRefreshRef.current?.(enriched);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch data';

      if (hadPreviousData && !manual) {
        setWarnings([`刷新失败: ${msg} (showing stale data)`]);
        setStatus('success');
      } else {
        setError(msg);
        setStatus('error');
        if (manual) {
          poolsRef.current = [];
          setRawPools([]);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  useEffect(() => {
    poolsRef.current = [];
    setRawPools([]);
    setError(null);
    setWarnings([]);
    setStatus('loading');
    fetchData(false);

    intervalRef.current = setInterval(() => fetchData(false), REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const pools = useMemo(
    () => applyTimeWindow(rawPools, timeWindow, samplerRef.current),
    [rawPools, timeWindow],
  );

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
    timeWindow,
    setTimeWindow,
    refresh: () => fetchData(true),
    totalCount: pools.length,
    isEmpty: status === 'success' && pools.length === 0,
  };
}
