import { describe, it, expect } from 'vitest';
import { applyTimeWindow } from './windowCalc';
import type { PoolData } from '../types';

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    id: 'test-pool',
    pairAddress: '0xabc',
    token0Symbol: 'A',
    token1Symbol: 'B',
    token0Address: '0x1',
    token1Address: '0x2',
    dex: 'Uniswap',
    version: 'V3',
    chainId: 56,
    priceUsd: 100,
    feeRate: 0.30,
    feeUsd: null,
    tvlUsd: 500_000,
    feeTvlRatio: null,
    volumeUsd: null,
    txCount: null,
    pairSymbol: 'A/B',
    windows: {
      m5: { volume: 10_000, txCount: 50 },
      h1: { volume: 120_000, txCount: 600 },
      h6: { volume: 500_000, txCount: 3000 },
      h24: { volume: 2_000_000, txCount: 12000 },
    },
    ...overrides,
  };
}

describe('applyTimeWindow', () => {
  it('applies 5m window', () => {
    const pools = applyTimeWindow([makePool()], 'm5');
    expect(pools[0].volumeUsd).toBe(10_000);
    expect(pools[0].txCount).toBe(50);
    expect(pools[0].feeUsd).toBeCloseTo(30); // 10000 * 0.30 / 100
    expect(pools[0].feeTvlRatio).toBeCloseTo((30 / 500_000) * 100);
  });

  it('applies 1h window', () => {
    const pools = applyTimeWindow([makePool()], 'h1');
    expect(pools[0].volumeUsd).toBe(120_000);
    expect(pools[0].txCount).toBe(600);
    expect(pools[0].feeUsd).toBeCloseTo(360);
  });

  it('applies 6h window', () => {
    const pools = applyTimeWindow([makePool()], 'h6');
    expect(pools[0].volumeUsd).toBe(500_000);
    expect(pools[0].txCount).toBe(3000);
    expect(pools[0].feeUsd).toBeCloseTo(1500);
  });

  it('applies 24h window', () => {
    const pools = applyTimeWindow([makePool()], 'h24');
    expect(pools[0].volumeUsd).toBe(2_000_000);
    expect(pools[0].txCount).toBe(12000);
    expect(pools[0].feeUsd).toBeCloseTo(6000);
  });

  it('returns null fee when feeRate is null', () => {
    const pool = makePool({ feeRate: null });
    const pools = applyTimeWindow([pool], 'm5');
    expect(pools[0].feeUsd).toBeNull();
    expect(pools[0].feeTvlRatio).toBeNull();
  });

  it('returns null fee when volume is null', () => {
    const pool = makePool({
      windows: {
        m5: { volume: null, txCount: null },
        h1: { volume: 120_000, txCount: 600 },
        h6: { volume: 500_000, txCount: 3000 },
        h24: { volume: 2_000_000, txCount: 12000 },
      },
    });
    const pools = applyTimeWindow([pool], 'm5');
    expect(pools[0].volumeUsd).toBeNull();
    expect(pools[0].feeUsd).toBeNull();
  });

  it('applies 15m window with no sampler (all null)', () => {
    const pools = applyTimeWindow([makePool()], 'm15');
    expect(pools[0].volumeUsd).toBeNull();
    expect(pools[0].feeUsd).toBeNull();
    expect(pools[0].txCount).toBeNull();
  });

  it('preserves feeRate and tvlUsd across windows', () => {
    const pool = makePool({ feeRate: 0.05, tvlUsd: 1_000_000 });
    for (const tw of ['m5', 'h1', 'h6', 'h24'] as const) {
      const pools = applyTimeWindow([pool], tw);
      expect(pools[0].feeRate).toBe(0.05);
      expect(pools[0].tvlUsd).toBe(1_000_000);
    }
  });

  it('handles multiple pools', () => {
    const pool1 = makePool({ id: 'p1', feeRate: 0.25 });
    const pool2 = makePool({ id: 'p2', feeRate: 0.30 });
    const pools = applyTimeWindow([pool1, pool2], 'h1');
    expect(pools[0].feeUsd).toBeCloseTo(300); // 120000 * 0.25/100
    expect(pools[1].feeUsd).toBeCloseTo(360); // 120000 * 0.30/100
  });
});
