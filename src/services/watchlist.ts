const STORAGE_KEY = 'lp-watchlist-v1';

export interface WatchlistEntry {
  pairAddress: string;
  chainId: number;
  note?: string;
  addedAt: number;
}

function normalize(addr: string): string {
  return addr.toLowerCase().trim();
}

function load(): WatchlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WatchlistEntry[];
  } catch {
    return [];
  }
}

function save(entries: WatchlistEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota exceeded
  }
}

export function getWatchlist(chainId?: number): WatchlistEntry[] {
  const all = load();
  if (chainId === undefined) return all;
  return all.filter((e) => e.chainId === chainId);
}

export function isWatchlisted(pairAddress: string, chainId: number): boolean {
  const norm = normalize(pairAddress);
  return load().some((e) => normalize(e.pairAddress) === norm && e.chainId === chainId);
}

export function addToWatchlist(pairAddress: string, chainId: number, note?: string): WatchlistEntry[] {
  const entries = load();
  const norm = normalize(pairAddress);
  if (entries.some((e) => normalize(e.pairAddress) === norm && e.chainId === chainId)) {
    return entries;
  }
  const entry: WatchlistEntry = {
    pairAddress: norm,
    chainId,
    note,
    addedAt: Date.now(),
  };
  const updated = [...entries, entry];
  save(updated);
  return updated;
}

export function removeFromWatchlist(pairAddress: string, chainId: number): WatchlistEntry[] {
  const norm = normalize(pairAddress);
  const updated = load().filter(
    (e) => !(normalize(e.pairAddress) === norm && e.chainId === chainId),
  );
  save(updated);
  return updated;
}

export function toggleWatchlist(pairAddress: string, chainId: number): { entries: WatchlistEntry[]; added: boolean } {
  if (isWatchlisted(pairAddress, chainId)) {
    return { entries: removeFromWatchlist(pairAddress, chainId), added: false };
  }
  return { entries: addToWatchlist(pairAddress, chainId), added: true };
}

export function clearWatchlist(chainId?: number): WatchlistEntry[] {
  if (chainId === undefined) {
    save([]);
    return [];
  }
  const updated = load().filter((e) => e.chainId !== chainId);
  save(updated);
  return updated;
}
