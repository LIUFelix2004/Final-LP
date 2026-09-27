import type { StockFeeRow } from '../../types/stocks';

const SAMPLER_KEY = 'stocks-fee-sampler-v2';

interface SamplerStore {
  v: 2;
  fast: Record<string, Array<[number, number | null]>>;
  slow: Record<string, Array<[number, number | null]>>;
  lastFastTime: number;
  lastSlowTime: number;
}

const FAST_INTERVAL_MS = 5 * 60 * 1000;
const FAST_TTL_MS = 40 * 60 * 1000;
const SLOW_TTL_MS = 8 * 24 * 3600 * 1000;
const MAX_FAST_PER_SYMBOL = 10;
const MAX_SLOW_PER_SYMBOL = 400;

let cachedStore: SamplerStore | null = null;
let cachedSampled: Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }> | null = null;

function emptyStore(): SamplerStore {
  return { v: 2, fast: {}, slow: {}, lastFastTime: 0, lastSlowTime: 0 };
}

function loadStore(): SamplerStore {
  if (cachedStore) return cachedStore;
  try {
    const raw = localStorage.getItem(SAMPLER_KEY);
    if (!raw) {
      cachedStore = emptyStore();
      return cachedStore;
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 2) {
      cachedStore = parsed as SamplerStore;
      return cachedStore;
    }
    cachedStore = emptyStore();
    return cachedStore;
  } catch {
    cachedStore = emptyStore();
    return cachedStore;
  }
}

function saveStore(store: SamplerStore): void {
  cachedStore = store;
  try {
    localStorage.setItem(SAMPLER_KEY, JSON.stringify(store));
  } catch {
    const now = Date.now();
    for (const sym of Object.keys(store.fast)) {
      store.fast[sym] = store.fast[sym].filter(p => now - p[0] < FAST_TTL_MS / 2);
    }
    for (const sym of Object.keys(store.slow)) {
      store.slow[sym] = store.slow[sym].filter(p => now - p[0] < SLOW_TTL_MS / 2);
    }
    try {
      localStorage.setItem(SAMPLER_KEY, JSON.stringify(store));
    } catch { /* give up */ }
  }
}

function alignToHalfHour(ts: number): number {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m >= 30 ? 30 : 0);
  return d.getTime();
}

function nextHalfHourBoundary(ts: number): number {
  const aligned = alignToHalfHour(ts);
  return aligned + 30 * 60 * 1000;
}

export function recordSample(rows: StockFeeRow[]): void {
  const store = loadStore();
  const now = Date.now();

  const doFast = now - store.lastFastTime >= FAST_INTERVAL_MS;
  const nextBoundary = nextHalfHourBoundary(store.lastSlowTime || 0);
  const doSlow = now >= nextBoundary;

  if (!doFast && !doSlow) return;

  if (doFast) {
    for (const row of rows) {
      if (!store.fast[row.symbol]) store.fast[row.symbol] = [];
      store.fast[row.symbol].push([now, row.fee.m5]);
    }
    store.lastFastTime = now;

    const fastCutoff = now - FAST_TTL_MS;
    for (const sym of Object.keys(store.fast)) {
      store.fast[sym] = store.fast[sym].filter(p => p[0] >= fastCutoff);
      if (store.fast[sym].length > MAX_FAST_PER_SYMBOL) {
        store.fast[sym] = store.fast[sym].slice(-MAX_FAST_PER_SYMBOL);
      }
      if (store.fast[sym].length === 0) delete store.fast[sym];
    }
  }

  if (doSlow) {
    const alignedTime = alignToHalfHour(now);
    for (const row of rows) {
      if (!store.slow[row.symbol]) store.slow[row.symbol] = [];
      store.slow[row.symbol].push([alignedTime, row.fee.h24]);
    }
    store.lastSlowTime = now;

    const slowCutoff = now - SLOW_TTL_MS;
    for (const sym of Object.keys(store.slow)) {
      store.slow[sym] = store.slow[sym].filter(p => p[0] >= slowCutoff);
      if (store.slow[sym].length > MAX_SLOW_PER_SYMBOL) {
        store.slow[sym] = store.slow[sym].slice(-MAX_SLOW_PER_SYMBOL);
      }
      if (store.slow[sym].length === 0) delete store.slow[sym];
    }
  }

  saveStore(store);
  cachedSampled = null;
}

function computeM30(symbol: string, store: SamplerStore, now: number): { value: number | null; count: number } {
  const points = store.fast[symbol];
  if (!points || points.length === 0) return { value: null, count: 0 };

  const cutoff = now - 30 * 60 * 1000;
  const recent = points.filter(p => p[0] > cutoff && p[1] !== null).slice(-6);
  if (recent.length === 0) return { value: null, count: 0 };

  const expectedBuckets = 6;
  const sum = recent.reduce((s, p) => s + p[1]!, 0);
  const value = recent.length >= expectedBuckets ? sum : sum * (expectedBuckets / recent.length);
  return { value, count: recent.length };
}

function findClosestSlowPoint(
  points: Array<[number, number | null]>,
  targetTime: number,
  tolerance: number,
): [number, number | null] | null {
  let best: [number, number | null] | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    if (p[1] === null) continue;
    const diff = Math.abs(p[0] - targetTime);
    if (diff <= tolerance && diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

function computeMultiDayFee(symbol: string, days: number, store: SamplerStore, now: number): number | null {
  const points = store.slow[symbol];
  if (!points || points.length === 0) return null;

  const tolerance = 45 * 60 * 1000;
  let total = 0;

  for (let d = 0; d < days; d++) {
    const target = now - d * 24 * 3600 * 1000;
    const point = findClosestSlowPoint(points, target, tolerance);
    if (!point) return null;
    total += point[1]!;
  }

  return total;
}

function computeAllSampled(store: SamplerStore, now: number): Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }> {
  const symbols = new Set<string>();
  for (const sym of Object.keys(store.fast)) symbols.add(sym);
  for (const sym of Object.keys(store.slow)) symbols.add(sym);

  const result = new Map<string, { m30: number | null; h48: number | null; h72: number | null; d7: number | null }>();
  for (const symbol of symbols) {
    result.set(symbol, {
      m30: computeM30(symbol, store, now).value,
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

export function getSamplerStats(): { slowMaxCount: number; lastSlowTime: number; nextSlowTime: number } {
  const store = loadStore();
  let maxCount = 0;
  for (const sym of Object.keys(store.slow)) {
    if (store.slow[sym].length > maxCount) maxCount = store.slow[sym].length;
  }
  const next = nextHalfHourBoundary(store.lastSlowTime || Date.now());
  return {
    slowMaxCount: maxCount,
    lastSlowTime: store.lastSlowTime,
    nextSlowTime: next,
  };
}

export function getM30SampleCount(symbol: string): number {
  const store = loadStore();
  const now = Date.now();
  return computeM30(symbol, store, now).count;
}

export function _resetCache(): void {
  cachedStore = null;
  cachedSampled = null;
}

export { alignToHalfHour, nextHalfHourBoundary, computeM30 as _computeM30, computeMultiDayFee as _computeMultiDayFee, loadStore as _loadStore, emptyStore as _emptyStore, type SamplerStore as _SamplerStore };
