import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordSample, enrichRowsWithSampled, getSamplerStats, getM30SampleCount, alignToHalfHour, nextHalfHourBoundary, _computeM30, _computeMultiDayFee, _emptyStore, _resetCache } from './feeSampler';
import type { StockFeeRow } from '../../types/stocks';

function makeRow(symbol: string, fee: Partial<StockFeeRow['fee']> = {}): StockFeeRow {
  return {
    symbol,
    name: symbol,
    address: `0x${symbol.toLowerCase()}`,
    pools: [],
    mainPool: null,
    onchainPrice: null,
    fee: { m5: fee.m5 ?? 100, h1: fee.h1 ?? null, h6: fee.h6 ?? null, h24: fee.h24 ?? 500 },
    feeUnknownCount: 0,
    feeUnknownVolume24h: 0,
  };
}

describe('feeSampler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    _resetCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('alignToHalfHour aligns correctly', () => {
    const d = new Date('2026-09-27T10:17:00Z').getTime();
    const aligned = alignToHalfHour(d);
    expect(new Date(aligned).getMinutes()).toBe(0);

    const d2 = new Date('2026-09-27T10:45:00Z').getTime();
    const aligned2 = alignToHalfHour(d2);
    expect(new Date(aligned2).getMinutes()).toBe(30);
  });

  it('nextHalfHourBoundary returns next boundary after the aligned time', () => {
    const d = new Date('2026-09-27T10:17:00Z').getTime();
    const next = nextHalfHourBoundary(d);
    expect(next).toBeGreaterThan(d);
    expect(new Date(next).getMinutes()).toBe(30);

    const exact = new Date('2026-09-27T10:30:00Z').getTime();
    const nextAfterExact = nextHalfHourBoundary(exact);
    expect(nextAfterExact).toBeGreaterThan(exact);
    expect(new Date(nextAfterExact).getMinutes()).toBe(0);
  });

  it('recordSample skips fast sample if within 5m interval', () => {
    const base = new Date('2026-09-27T10:00:00Z').getTime();
    vi.setSystemTime(base);

    const rows = [makeRow('HIMS'), makeRow('NVDA')];
    recordSample(rows);

    const stats = getSamplerStats();
    expect(stats.slowMaxCount).toBe(1);

    vi.setSystemTime(base + 3 * 60 * 1000);
    _resetCache();
    recordSample(rows);
    const stats2 = getSamplerStats();
    expect(stats2.slowMaxCount).toBe(1);
  });

  it('recordSample stores slow samples at :00/:30 boundaries', () => {
    const base = new Date('2026-09-27T10:00:00Z').getTime();
    vi.setSystemTime(base);

    const rows = [makeRow('HIMS')];
    recordSample(rows);

    vi.setSystemTime(base + 31 * 60 * 1000);
    recordSample(rows);

    const stats = getSamplerStats();
    expect(stats.slowMaxCount).toBe(2);
  });

  it('enrichRowsWithSampled returns sampled data', () => {
    const base = new Date('2026-09-27T10:00:00Z').getTime();
    vi.setSystemTime(base);

    const rows = [makeRow('HIMS')];
    recordSample(rows);

    const enriched = enrichRowsWithSampled(rows);
    expect(enriched[0].sampled).toBeDefined();
    expect(enriched[0].sampled!.m30).not.toBeNull();
  });

  it('computeM30 scales correctly with fewer than 6 points', () => {
    const store = _emptyStore();
    const now = Date.now();
    store.fast['HIMS'] = [
      [now - 10 * 60_000, 100],
      [now - 5 * 60_000, 200],
    ];
    const result = _computeM30('HIMS', store, now);
    expect(result.count).toBe(2);
    expect(result.value).toBe(300 * (6 / 2));
  });

  it('computeM30 with 6+ points sums without scaling', () => {
    const store = _emptyStore();
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      if (!store.fast['HIMS']) store.fast['HIMS'] = [];
      store.fast['HIMS'].push([now - (25 - i * 5) * 60_000, 100]);
    }
    const result = _computeM30('HIMS', store, now);
    expect(result.count).toBe(6);
    expect(result.value).toBe(600);
  });

  it('computeMultiDayFee returns null if missing a day', () => {
    const store = _emptyStore();
    const now = Date.now();
    store.slow['HIMS'] = [[now, 500]];
    const result = _computeMultiDayFee('HIMS', 2, store, now);
    expect(result).toBeNull();
  });

  it('computeMultiDayFee sums when all days present', () => {
    const store = _emptyStore();
    const now = Date.now();
    store.slow['HIMS'] = [
      [now, 500],
      [now - 24 * 3600_000, 300],
    ];
    const result = _computeMultiDayFee('HIMS', 2, store, now);
    expect(result).toBe(800);
  });

  it('getM30SampleCount returns 0 for unknown symbol', () => {
    expect(getM30SampleCount('UNKNOWN')).toBe(0);
  });

  it('30M boundary at exact 5-min intervals yields 6 not 7 points', () => {
    const store = _emptyStore();
    const boundary = new Date('2026-01-01T00:30:00Z').getTime();
    for (let i = 0; i < 7; i++) {
      if (!store.fast['TEST']) store.fast['TEST'] = [];
      store.fast['TEST'].push([boundary - i * 5 * 60_000, 100]);
    }
    const cutoff = boundary - 30 * 60_000;
    const result = _computeM30('TEST', store, boundary);
    expect(result.count).toBe(6);
    const pointsInWindow = store.fast['TEST'].filter(([ts]) => ts > cutoff).slice(-6);
    expect(pointsInWindow).toHaveLength(6);
  });

  it('per-symbol slow samples capped at 400', () => {
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(base);
    const rows = [makeRow('HIMS')];

    for (let i = 0; i < 420; i++) {
      vi.setSystemTime(base + i * 30 * 60_000);
      _resetCache();
      recordSample(rows);
    }

    _resetCache();
    const raw = localStorage.getItem('stocks-fee-sampler-v2');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.slow['HIMS'].length).toBeLessThanOrEqual(400);
  });
});
