import { useState, useCallback, useEffect } from 'react';
import type { WatchlistEntry } from '../services/watchlist';
import {
  getWatchlist,
  isWatchlisted as checkWatchlisted,
  toggleWatchlist as toggle,
  addToWatchlist,
} from '../services/watchlist';

export function useWatchlist(chainId: number) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(() => getWatchlist(chainId));
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  useEffect(() => {
    setEntries(getWatchlist(chainId));
  }, [chainId]);

  const watchlistedAddrs = new Set(entries.map((e) => e.pairAddress.toLowerCase()));

  const isWatchlisted = useCallback(
    (pairAddress: string) => checkWatchlisted(pairAddress, chainId),
    [chainId],
  );

  const togglePool = useCallback(
    (pairAddress: string) => {
      const result = toggle(pairAddress, chainId);
      setEntries(getWatchlist(chainId));
      return result.added;
    },
    [chainId],
  );

  const addPool = useCallback(
    (pairAddress: string, note?: string) => {
      addToWatchlist(pairAddress, chainId, note);
      setEntries(getWatchlist(chainId));
    },
    [chainId],
  );

  return {
    entries,
    watchlistedAddrs,
    watchlistOnly,
    setWatchlistOnly,
    isWatchlisted,
    togglePool,
    addPool,
    count: entries.length,
  };
}
