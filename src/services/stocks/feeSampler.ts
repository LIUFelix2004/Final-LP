import type { StockFeeRow } from '../../types/stocks';

const SAMPLER_KEY = 'stocks-fee-samples-v1';

interface SamplePoint {
  timestamp: number;
  symbol: string;
  fee: {
    m5: number | null;
    h1: number | null;
    h24: number | null;
  };
}

interface SamplerStore {
  points: SamplePoint[];
  lastSampleTime: number;
}

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_POINTS = 2016;

function loadStore(): SamplerStore {
  try {
    const raw = localStorage.getItem(SAMPLER_KEY);
    if (!raw) return { points: [], lastSampleTime: 0 };
    return JSON.parse(raw);
  } catch {
    return { points: [], lastSampleTime: 0 };
  }
}

function saveStore(store: SamplerStore): void {
  try {
    localStorage.setItem(SAMPLER_KEY, JSON.stringify(store));
  } catch { /* quota exceeded */ }
}

export function recordSample(rows: StockFeeRow[]): void {
  const store = loadStore();
  const now = Date.now();
  if (now - store.lastSampleTime < SAMPLE_INTERVAL_MS) return;

  for (const row of rows) {
    store.points.push({
      timestamp: now,
      symbol: row.symbol,
      fee: {
        m5: row.fee.m5,
        h1: row.fee.h1,
        h24: row.fee.h24,
      },
    });
  }

  if (store.points.length > MAX_POINTS * rows.length) {
    const cutoff = now - 7 * 24 * 3600 * 1000;
    store.points = store.points.filter(p => p.timestamp > cutoff);
  }

  store.lastSampleTime = now;
  saveStore(store);
}

export function computeSampledFee(
  symbol: string,
  windowMs: number,
): number | null {
  const store = loadStore();
  const now = Date.now();
  const cutoff = now - windowMs;

  const relevant = store.points.filter(
    p => p.symbol === symbol && p.timestamp >= cutoff,
  );

  if (relevant.length < 2) return null;

  const fees = relevant
    .map(p => p.fee.h24)
    .filter((f): f is number => f !== null && Number.isFinite(f));

  if (fees.length === 0) return null;

  return fees.reduce((a, b) => a + b, 0) / fees.length;
}

export function enrichRowsWithSampled(rows: StockFeeRow[]): StockFeeRow[] {
  return rows.map(row => ({
    ...row,
    sampled: {
      m30: computeSampledFee(row.symbol, 30 * 60 * 1000),
      h48: computeSampledFee(row.symbol, 48 * 3600 * 1000),
      h72: computeSampledFee(row.symbol, 72 * 3600 * 1000),
      d7: computeSampledFee(row.symbol, 7 * 24 * 3600 * 1000),
    },
  }));
}
