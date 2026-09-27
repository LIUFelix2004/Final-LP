import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('viem', () => {
  const encodeFunctionData = vi.fn(() => '0xmocked');
  const decodeFunctionResult = vi.fn();
  const parseAbiItem = vi.fn(() => ({}));
  const createPublicClient = vi.fn(() => ({
    call: vi.fn(),
    getLogs: vi.fn(() => []),
  }));
  const http = vi.fn();
  return { encodeFunctionData, decodeFunctionResult, parseAbiItem, createPublicClient, http };
});

import { createPublicClient, decodeFunctionResult } from 'viem';
import type { StockPool } from '../../types/stocks';
import { quoteV3Pool, quoteV4Pool, quoteBestPool, analyzeAmount } from './quote';
import type { V4PoolKey } from './quote';
import { USDG_ADDRESS } from '../../config/stocks';

function makePool(overrides: Partial<StockPool> = {}): StockPool {
  return {
    pairAddress: '0xpool1',
    dexId: 'uniswap_v3',
    dex: 'Uniswap',
    labels: [],
    version: 'V3',
    tokenAddress: '0xTSLA',
    tokenSymbol: 'TSLA',
    isBaseUsdg: false,
    priceNative: 200,
    priceUsd: 200,
    liquidityUsd: 100_000,
    feeRate: 0.05,
    feeRateInferred: false,
    volume: { m5: null, h1: null, h6: null, h24: 50000 },
    ...overrides,
  };
}

describe('quoteV3Pool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for non-Uniswap pools', async () => {
    const pool = makePool({ dex: 'Ramses' });
    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).toBeNull();
  });

  it('returns null for V4 pools', async () => {
    const pool = makePool({ version: 'V4' });
    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).toBeNull();
  });

  it('returns null for pools with null feeRate', async () => {
    const pool = makePool({ feeRate: null });
    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).toBeNull();
  });

  it('quotes V3 buy correctly', async () => {
    const pool = makePool();
    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);
    vi.mocked(decodeFunctionResult).mockReturnValue([10_000000000000000000n, 0n, 0, 0n] as never);

    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('buy');
    expect(result!.effectivePrice).toBe(200);
    expect(result!.quotedVia).toBe('Uniswap V3 0.05%');
  });

  it('quotes V3 sell correctly', async () => {
    const pool = makePool();
    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);
    vi.mocked(decodeFunctionResult).mockReturnValue([1990_000000n, 0n, 0, 0n] as never);

    const result = await quoteV3Pool(pool, 2000, 'sell');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('sell');
    expect(result!.effectivePrice).toBeCloseTo(199, 0);
  });

  it('discards absurd prices (sanity check)', async () => {
    const pool = makePool({ priceNative: 200 });
    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);
    vi.mocked(decodeFunctionResult).mockReturnValue([100000000000000000n, 0n, 0, 0n] as never);

    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).toBeNull();
  });
});

describe('quoteV4Pool', () => {
  const usdgAddr = USDG_ADDRESS.toLowerCase() as `0x${string}`;
  const tokenAddr = '0xtsla'.padEnd(42, '0') as `0x${string}`;
  const v4PoolKey: V4PoolKey = {
    currency0: usdgAddr < tokenAddr ? usdgAddr : tokenAddr,
    currency1: usdgAddr < tokenAddr ? tokenAddr : usdgAddr,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes zeroForOne correctly for buy when USDG is currency0', async () => {
    const pool = makePool({ version: 'V4', pairAddress: '0x' + '00'.repeat(32), dex: 'Uniswap', tokenAddress: tokenAddr });

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const usdgIsCurrency0 = v4PoolKey.currency0.toLowerCase() === usdgAddr;
    const outIdx = usdgIsCurrency0 ? 1 : 0;
    const deltas = [0n, 0n] as bigint[];
    deltas[outIdx] = -10_000000000000000000n;
    deltas[1 - outIdx] = 2000_000000n;

    vi.mocked(decodeFunctionResult).mockReturnValue([deltas, 0n, 0] as never);

    const result = await quoteV4Pool(pool, v4PoolKey, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('buy');
    expect(result!.effectivePrice).toBe(200);
  });

  it('handles dynamic fee label', async () => {
    const pool = makePool({ version: 'V4', pairAddress: '0x' + '00'.repeat(32), dex: 'Uniswap', tokenAddress: tokenAddr });
    const dynamicKey: V4PoolKey = { ...v4PoolKey, fee: 0x800000 };

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const usdgIsCurrency0 = dynamicKey.currency0.toLowerCase() === usdgAddr;
    const outIdx = usdgIsCurrency0 ? 1 : 0;
    const deltas = [0n, 0n] as bigint[];
    deltas[outIdx] = -10_000000000000000000n;
    deltas[1 - outIdx] = 2000_000000n;

    vi.mocked(decodeFunctionResult).mockReturnValue([deltas, 0n, 0] as never);

    const result = await quoteV4Pool(pool, dynamicKey, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.quotedVia).toBe('Uniswap V4 动态费');
  });
});

describe('quoteBestPool', () => {
  it('returns null when no Uniswap pools', async () => {
    const pools = [makePool({ dex: 'Ramses' }), makePool({ dex: 'Giga' })];
    const result = await quoteBestPool(pools, 2000, 'buy');
    expect(result).toBeNull();
  });
});

describe('analyzeAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes sellPremium as effSell/fair - 1', async () => {
    const pool = makePool();
    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: '0xresult' }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    vi.mocked(decodeFunctionResult)
      .mockReturnValueOnce([10_000000000000000000n, 0n, 0, 0n] as never)
      .mockReturnValueOnce([1960_000000n, 0n, 0, 0n] as never);

    const result = await analyzeAmount([pool], 2000, 200);
    expect(result.buyResult).not.toBeNull();
    expect(result.sellResult).not.toBeNull();
    if (result.sellResult && result.sellPremium !== null) {
      expect(result.sellPremium).toBeLessThan(0);
    }
  });
});
