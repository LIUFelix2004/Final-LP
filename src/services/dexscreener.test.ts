import { describe, it, expect } from 'vitest';
import {
  mapDexVersion,
  mapDexName,
  inferFeeRateFromDexId,
  estimateFeeUsd,
  FetchError,
  CHAIN_SLUG,
} from './dexscreener';

describe('mapDexVersion', () => {
  it('returns V2 for pancakeswap_v2', () => {
    expect(mapDexVersion('pancakeswap_v2')).toBe('V2');
  });

  it('returns V3 for uniswap_v3', () => {
    expect(mapDexVersion('uniswap_v3')).toBe('V3');
  });

  it('returns V4 for uniswap_v4', () => {
    expect(mapDexVersion('uniswap_v4')).toBe('V4');
  });

  it('returns V3 for slipstream dexes', () => {
    expect(mapDexVersion('up33_slipstream')).toBe('V3');
  });

  it('returns V3 for cl dexes', () => {
    expect(mapDexVersion('thena_cl')).toBe('V3');
  });

  it('defaults to V2 for unknown', () => {
    expect(mapDexVersion('some_dex')).toBe('V2');
  });
});

describe('mapDexName', () => {
  it('maps pancakeswap', () => {
    expect(mapDexName('pancakeswap_v2')).toBe('PancakeSwap');
  });

  it('maps uniswap', () => {
    expect(mapDexName('uniswap_v3')).toBe('Uniswap');
  });

  it('maps up33', () => {
    expect(mapDexName('up33_slipstream')).toBe('UP33');
  });

  it('maps aerodrome-like to UP33', () => {
    expect(mapDexName('aerodrome_v2')).toBe('UP33');
  });

  it('returns raw dexId for unknown', () => {
    expect(mapDexName('mystery_dex')).toBe('mystery_dex');
  });
});

describe('inferFeeRateFromDexId', () => {
  it('returns 0.25 for PancakeSwap V2', () => {
    expect(inferFeeRateFromDexId('pancakeswap_v2')).toBe(0.25);
  });

  it('returns 0.30 for Uniswap V2', () => {
    expect(inferFeeRateFromDexId('uniswap_v2')).toBe(0.30);
  });

  it('returns null for V3 (variable fee)', () => {
    expect(inferFeeRateFromDexId('uniswap_v3')).toBeNull();
  });

  it('returns null for V4 (variable fee)', () => {
    expect(inferFeeRateFromDexId('uniswap_v4')).toBeNull();
  });

  it('returns null for CL pools', () => {
    expect(inferFeeRateFromDexId('thena_cl')).toBeNull();
  });

  it('returns null for slipstream pools', () => {
    expect(inferFeeRateFromDexId('up33_slipstream')).toBeNull();
  });

  it('returns 0.10 for BiSwap', () => {
    expect(inferFeeRateFromDexId('biswap_v2')).toBe(0.10);
  });
});

describe('estimateFeeUsd', () => {
  it('returns null when fee rate is null', () => {
    expect(estimateFeeUsd(1000000, null)).toBeNull();
  });

  it('returns null when volume is 0', () => {
    expect(estimateFeeUsd(0, 0.30)).toBeNull();
  });

  it('computes V2 fee correctly: 1M vol × 0.30% = 3000', () => {
    expect(estimateFeeUsd(1_000_000, 0.30)).toBeCloseTo(3000);
  });

  it('computes PancakeSwap V2 fee: 1M vol × 0.25% = 2500', () => {
    expect(estimateFeeUsd(1_000_000, 0.25)).toBeCloseTo(2500);
  });

  it('computes V3 fee from on-chain rate: 1M vol × 0.05% = 500', () => {
    // V3 100bps = 0.01%, 500bps = 0.05%, 3000bps = 0.30%, 10000bps = 1.00%
    expect(estimateFeeUsd(1_000_000, 0.05)).toBeCloseTo(500);
  });

  it('computes V3 fee at 0.30% tier: 1M vol × 0.30% = 3000', () => {
    expect(estimateFeeUsd(1_000_000, 0.30)).toBeCloseTo(3000);
  });

  it('computes V3 fee at 1.00% tier: 1M vol × 1.00% = 10000', () => {
    expect(estimateFeeUsd(1_000_000, 1.00)).toBeCloseTo(10000);
  });
});

describe('FetchError', () => {
  it('captures status code', () => {
    const err = new FetchError('rate limited', 429, true);
    expect(err.statusCode).toBe(429);
    expect(err.retriable).toBe(true);
    expect(err.message).toBe('rate limited');
    expect(err.name).toBe('FetchError');
  });

  it('defaults retriable to false', () => {
    const err = new FetchError('not found', 404);
    expect(err.retriable).toBe(false);
  });
});

describe('CHAIN_SLUG', () => {
  it('maps BSC to bsc', () => {
    expect(CHAIN_SLUG[56]).toBe('bsc');
  });

  it('maps Robinhood to robinhood (not numeric)', () => {
    expect(CHAIN_SLUG[4663]).toBe('robinhood');
  });

  it('returns undefined for unknown chains', () => {
    expect(CHAIN_SLUG[1]).toBeUndefined();
  });
});
