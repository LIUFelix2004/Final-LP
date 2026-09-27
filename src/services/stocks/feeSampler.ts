import type { StockFeeRow } from '../../types/stocks';

const SAMPLER_KEY = 'stocks-fee-sampler-v1';

interface FastPoint {
  t: number;
  symbol: string;
  feeM5: number | null;
}

interface SlowPoint {
  t: number;
  symbol: string;
  feeH24: number | null;
}

interface SamplerStore {
  fast: FastPoint[];
  slow: SlowPoint[];
  lastFastTime: number;
  lastSlowTime: number;
}

const FAST_INTERVAL_MS = 5 * 60 * 1000;
const FAST_TTL_MS = 40 * 60 * 1000;
const SLOW_TTL_MS = 8 * 24 * 3600 * 1000;
const MAX_FAST_POINTS = 2000;
const MAX_SLOW_POINTS = 5000;

let cachedStore: SamplerStore | null = null;
let cachedSampled: Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }> | null = null;

function loadStore(): SamplerStore {
  if (cachedStore) return cachedStore;
  try {
    const raw = localStorage.getItem(SAMPLER_KEY);
    if (!raw) {
      cachedStore = { fast: [], slow: [], lastFastTime: 0, lastSlowTime: 0 };
      return cachedStore;
    }
    cachedStore = JSON.parse(raw);
    return cachedStore!;
  } catch {
    cachedStore = { fast: [], slow: [], lastFastTime: 0, lastSlowTime: 0 };
    return cachedStore;
  }
}

function saveStore(store: SamplerStore): void {
  cachedStore = store;
  try {
    localStorage.setItem(SAMPLER_KEY, JSON.stringify(store));
  } catch {
    const now = Date.now();
    store.fast = store.fast.filter(p => now - p.t < FAST_TTL_MS / 2);
    store.slow = store.slow.filter(p => now - p.t < SLOW_TTL_MS / 2);
    try {
      localStorage.setItem(SAMPLER_KEY, JSON.stringify(store));
    } catch { /* give up */ }
  }
}

function isSlowTime(now: Date): boolean {
  const mins = now.getMinutes();
  return mins === 0 || mins === 30;
}

export function recordSample(rows: StockFeeRow[]): void {
  const store = loadStore();
  const now = Date.now();
  const nowDate = new Date(now);

  const doFast = now - store.lastFastTime >= FAST_INTERVAL_MS;
  const doSlow = isSlowTime(nowDate) && now - store.lastSlowTime >= 25 * 60 * 1000;

  if (!doFast && !doSlow) return;

  if (doFast) {
    for (const row of rows) {
      store.fast.push({ t: now, symbol: row.symbol, feeM5: row.fee.m5 });
    }
    store.lastFastTime = now;

    const fastCutoff = now - FAST_TTL_MS;
    store.fast = store.fast.filter(p => p.t >= fastCutoff);
    if (store.fast.length > MAX_FAST_POINTS) {
      store.fast = store.fast.slice(-MAX_FAST_POINTS);
    }
  }

  if (doSlow) {
    for (const row of rows) {
      store.slow.push({ t: now, symbol: row.symbol, feeH24: row.fee.h24 });
    }
    store.lastSlowTime = now;

    const slowCutoff = now - SLOW_TTL_MS;
    store.slow = store.slow.filter(p => p.t >= slowCutoff);
    if (store.slow.length > MAX_SLOW_POINTS) {
      store.slow = store.slow.slice(-MAX_SLOW_POINTS);
    }
  }

  saveStore(store);
  cachedSampled = null;
}

function computeM30(symbol: string, store: SamplerStore, now: number): number | null {
  const cutoff = now - 30 * 60 * 1000;
  const points = store.fast.filter(p => p.symbol === symbol && p.t >= cutoff && p.feeM5 !== null);
  if (points.length === 0) return null;

  const sum = points.reduce((s, p) => s + p.feeM5!, 0);
  const expectedBuckets = 6;
  if (points.length >= expectedBuckets) return sum;
  return sum * (expectedBuckets / points.length);
}

function findClosestSlowPoint(symbol: string, targetTime: number, tolerance: number, store: SamplerStore): SlowPoint | null {
  let best: SlowPoint | null = null;
  let bestDiff = Infinity;
  for (const p of store.slow) {
    if (p.symbol !== symbol || p.feeH24 === null) continue;
    const diff = Math.abs(p.t - targetTime);
    if (diff <= tolerance && diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

function computeMultiDayFee(symbol: string, days: number, store: SamplerStore, now: number): number | null {
  const tolerance = 45 * 60 * 1000;
  let total = 0;
  let found = 0;

  for (let d = 0; d < days; d++) {
    const target = now - d * 24 * 3600 * 1000;
    const point = findClosestSlowPoint(symbol, target, tolerance, store);
    if (point) {
      total += point.feeH24!;
      found++;
    }
  }

  if (found === 0) return null;
  if (found < Math.ceil(days / 2)) return null;

  return total;
}

function computeAllSampled(store: SamplerStore, now: number): Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }> {
  const symbols = new Set<string>();
  for (const p of store.fast) symbols.add(p.symbol);
  for (const p of store.slow) symbols.add(p.symbol);

  const result = new Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }>();
  for (const symbol of symbols) {
    result.set(symbol, {
      m30: computeM30(symbol, store, now),
      h48: computeMultiDayFee(symbol, 2, store, now),
      h72: computeMultiDayFee(symbol, 3, store, now),
      d7: computeMultiDayFee(symbol, 7, store, now),
    });
  }
  return result;
}

export function enrichRowsWithSampled(rows: StockFeeRow[]): StockFeeRow[] {
  const store = loadStore();
  if (!cachedSampled) {
    cachedSampled = computeAllSampled(store, Date.now());
  }
  return rows.map(row => ({
    ...row,
    sampled: cachedSampled!.get(row.symbol) ?? { m30: null, h48: null, h72: null, d7: null },
  }));
}

export function getSamplerStats(): { fastCount: number; slowCount: number; lastFastTime: number; lastSlowTime: number } {
  const store = loadStore();
  return {
    fastCount: store.fast.length,
    slowCount: store.slow.length,
    lastFastTime: store.lastFastTime,
    lastSlowTime: store.lastSlowTime,
  };
}
