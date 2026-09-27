import { describe, it, expect } from 'vitest';
import {
  buildFeeRow,
  selectMainPool,
  getOnchainPrice,
  computeTickerFee,
} from './pools';
import type { StockPool, StockToken } from '../../types/stocks';

function makePool(overrides: Partial<StockPool> = {}): StockPool {
  return {
    pairAddress: '0xabc',
    dexId: 'uniswap_v3',
    dex: 'Uniswap',
    labels: ['V3'],
    version: 'V3',
    tokenAddress: '0x1234',
    tokenSymbol: 'AAPL',
    isBaseUsdg: false,
    priceNative: 200,
    priceUsd: 200,
    liquidityUsd: 50_000,
    feeRate: 0.30,
    feeRateInferred: false,
    volume: { m5: 100, h1: 500, h6: 3000, h24: 10_000 },
    ...overrides,
  };
}

const testToken: StockToken = {
  address: '0x1234',
  symbol: 'AAPL',
  name: 'Apple',
  official: true,
};

describe('selectMainPool', () => {
  it('selects pool with highest liquidity', () => {
    const pools = [
      makePool({ pairAddress: '0xa', liquidityUsd: 10_000 }),
      makePool({ pairAddress: '0xb', liquidityUsd: 50_000 }),
      makePool({ pairAddress: '0xc', liquidityUsd: 30_000 }),
    ];
    const main = selectMainPool(pools);
    expect(main?.pairAddress).toBe('0xb');
  });

  it('returns null for empty array', () => {
    expect(selectMainPool([])).toBeNull();
  });
});

describe('getOnchainPrice', () => {
  it('returns priceNative of main pool', () => {
    const pool = makePool({ priceNative: 205.5 });
    expect(getOnchainPrice(pool)).toBe(205.5);
  });

  it('returns null for null pool', () => {
    expect(getOnchainPrice(null)).toBeNull();
  });
});

describe('computeTickerFee', () => {
  it('computes fee as volume × feeRate/100', () => {
    const pools = [
      makePool({ feeRate: 0.30, volume: { m5: 100, h1: 500, h6: 3000, h24: 10_000 } }),
    ];
    const result = computeTickerFee(pools, 'h24');
    expect(result.fee).toBeCloseTo(10_000 * 0.003, 2);
    expect(result.unknownCount).toBe(0);
  });

  it('tracks unknown pools', () => {
    const pools = [
      makePool({ feeRate: null, volume: { m5: 100, h1: 500, h6: 3000, h24: 10_000 } }),
    ];
    const result = computeTickerFee(pools, 'h24');
    expect(result.fee).toBeNull();
    expect(result.unknownCount).toBe(1);
    expect(result.unknownVolume).toBe(10_000);
  });

  it('returns null fee when no volume', () => {
    const pools = [
      makePool({ feeRate: 0.30, volume: { m5: 0, h1: 0, h6: 0, h24: 0 } }),
    ];
    const result = computeTickerFee(pools, 'h24');
    expect(result.fee).toBeNull();
  });

  it('aggregates multiple pools', () => {
    const pools = [
      makePool({ pairAddress: '0xa', feeRate: 0.30, volume: { m5: 0, h1: 0, h6: 0, h24: 10_000 } }),
      makePool({ pairAddress: '0xb', feeRate: 0.05, volume: { m5: 0, h1: 0, h6: 0, h24: 5_000 } }),
    ];
    const result = computeTickerFee(pools, 'h24');
    expect(result.fee).toBeCloseTo(10_000 * 0.003 + 5_000 * 0.0005, 2);
  });
});

describe('buildFeeRow', () => {
  it('builds a row with all fee windows', () => {
    const pool = makePool({ feeRate: 0.30, volume: { m5: 100, h1: 500, h6: 3000, h24: 10_000 } });
    const row = buildFeeRow(testToken, [pool]);
    expect(row.symbol).toBe('AAPL');
    expect(row.name).toBe('Apple');
    expect(row.address).toBe('0x1234');
    expect(row.mainPool).not.toBeNull();
    expect(row.fee.h24).toBeCloseTo(10_000 * 0.003, 2);
  });

  it('handles empty pools', () => {
    const row = buildFeeRow(testToken, []);
    expect(row.mainPool).toBeNull();
    expect(row.onchainPrice).toBeNull();
    expect(row.fee.h24).toBeNull();
  });
});
