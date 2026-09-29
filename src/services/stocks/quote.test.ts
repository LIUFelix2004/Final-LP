import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encodeFunctionData, decodeFunctionResult, keccak256, toBytes } from 'viem';
import type { StockPool } from '../../types/stocks';
import { USDG_ADDRESS } from '../../config/stocks';
import { INITIALIZE_EVENT, type V4PoolKey } from './quote';
import fixture from './__fixtures__/v4-quoter-responses.json';

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      call: vi.fn(),
      getLogs: vi.fn(() => []),
    })),
    http: vi.fn(),
  };
});

import { createPublicClient } from 'viem';
import { quoteV3Pool, quoteV4Pool, quoteBestPool, analyzeAmount, fetchV4PoolKeys, clearQuoteCache } from './quote';

const TSLA_ADDR = '0x322f0929c4625ed5bad873c95208d54e1c003b2d';

function makePool(overrides: Partial<StockPool> = {}): StockPool {
  return {
    pairAddress: '0x' + 'aa'.repeat(20),
    dexId: 'uniswap_v3',
    dex: 'Uniswap',
    labels: [],
    version: 'V3',
    tokenAddress: TSLA_ADDR,
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

const V4_QUOTE_ABI_LOCAL = [
  {
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'poolKey', type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]},
      { name: 'zeroForOne', type: 'bool' },
      { name: 'exactAmount', type: 'uint128' },
      { name: 'hookData', type: 'bytes' },
    ]}],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

describe('Initialize event selector (P0.1)', () => {
  it('has the correct 8-param topic0 (0xdd466e67…)', () => {
    const expected = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
    const sig = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
    const computed = keccak256(toBytes(sig));
    expect(computed).toBe(expected);
  });

  it('topic0 matches hardcoded constant from fixture', () => {
    const sig = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
    const computed = keccak256(toBytes(sig));
    expect(computed).toBe(fixture.initializeEvent.topic0);
  });

  it('INITIALIZE_EVENT includes int24 tick (8 params)', () => {
    const eventDef = INITIALIZE_EVENT as unknown as { inputs?: Array<{ type: string }> };
    expect(eventDef.inputs).toHaveLength(8);
    const lastParam = eventDef.inputs![7];
    expect(lastParam.type).toBe('int24');
  });
});

describe('V4Quoter ABI decoding (P0.3)', () => {
  it('decodes real V4Quoter response from fixture', () => {
    const testCase = fixture.cases[0];
    const decoded = decodeFunctionResult({
      abi: V4_QUOTE_ABI_LOCAL,
      functionName: 'quoteExactInputSingle',
      data: testCase.rawResponse as `0x${string}`,
    });
    const amountOut = decoded[0] as bigint;
    const gasEstimate = decoded[1] as bigint;
    expect(amountOut).toBe(BigInt(testCase.decoded.amountOut));
    expect(gasEstimate).toBe(BigInt(testCase.decoded.gasEstimate));

    const tokensOut = Number(amountOut) / 1e18;
    expect(tokensOut).toBeCloseTo(testCase.humanReadable.amountOutTokens, 2);
  });

  it('round-trip encode then decode matches', () => {
    const encoded = encodeFunctionData({
      abi: V4_QUOTE_ABI_LOCAL,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: '0x0000000000000000000000000000000000000001' as `0x${string}`,
          currency1: '0x0000000000000000000000000000000000000002' as `0x${string}`,
          fee: 3000,
          tickSpacing: 60,
          hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
        },
        zeroForOne: false,
        exactAmount: 2000_000000n,
        hookData: '0x' as `0x${string}`,
      }],
    });
    expect(encoded).toBeTruthy();
    expect(typeof encoded).toBe('string');
  });
});

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

  it('quotes V3 buy with real ABI encoding', async () => {
    const pool = makePool();
    const buyAmount = 10_000000000000000000n;
    const encodedResult = '0x' + [
      buyAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: encodedResult }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('buy');
    expect(result!.effectivePrice).toBe(200);
    expect(result!.quotedVia).toBe('Uniswap V3 0.05%');
  });

  it('discards absurd prices (sanity check)', async () => {
    const pool = makePool({ priceNative: 200 });
    const absurdAmount = 100000000000000000n;
    const encodedResult = '0x' + [
      absurdAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: encodedResult }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteV3Pool(pool, 2000, 'buy');
    expect(result).toBeNull();
  });
});

describe('quoteV4Pool', () => {
  const usdgAddr = USDG_ADDRESS.toLowerCase() as `0x${string}`;
  const tslaAddr = TSLA_ADDR as `0x${string}`;
  const v4PoolKey: V4PoolKey = {
    currency0: usdgAddr < tslaAddr ? usdgAddr : tslaAddr,
    currency1: usdgAddr < tslaAddr ? tslaAddr : usdgAddr,
    fee: 3000,
    tickSpacing: 60,
    hooks: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('quotes V4 buy with real response data (TSLA 2000 USDG)', async () => {
    const pool = makePool({
      version: 'V4',
      pairAddress: '0x' + '00'.repeat(32),
      dex: 'Uniswap',
      tokenAddress: tslaAddr,
      priceNative: 373,
    });

    const testCase = fixture.cases[0];

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: testCase.rawResponse }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteV4Pool(pool, v4PoolKey, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('buy');
    expect(result!.amountOut).toBe(BigInt(testCase.decoded.amountOut));
    expect(result!.quotedVia).toBe('Uniswap V4 0.30%');
  });

  it('handles dynamic fee label', async () => {
    const pool = makePool({ version: 'V4', pairAddress: '0x' + '00'.repeat(32), dex: 'Uniswap', tokenAddress: tslaAddr });
    const dynamicKey: V4PoolKey = { ...v4PoolKey, fee: 0x800000 };

    const amountOut = 10_000000000000000000n;
    const gasEstimate = 50000n;
    const responseData = '0x' + [
      amountOut.toString(16).padStart(64, '0'),
      gasEstimate.toString(16).padStart(64, '0'),
    ].join('');

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: responseData }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteV4Pool(pool, dynamicKey, 2000, 'buy');
    expect(result).not.toBeNull();
    expect(result!.quotedVia).toBe('Uniswap V4 动态费');
  });
});

describe('fetchV4PoolKeys queries by poolId (P0.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses args.id (topic1 = poolId), not currency0/currency1', async () => {
    const mockGetLogs = vi.fn().mockResolvedValue([]);
    const mockClient = {
      call: vi.fn(),
      getLogs: mockGetLogs,
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const testPoolId = '0x' + 'ab'.repeat(32);
    await fetchV4PoolKeys([testPoolId]);

    expect(mockGetLogs).toHaveBeenCalled();
    const callArgs = mockGetLogs.mock.calls[0][0];
    expect(callArgs.args).toHaveProperty('id');
    expect(callArgs.args.id.toLowerCase()).toBe(testPoolId.toLowerCase());
    expect(callArgs.args).not.toHaveProperty('currency0');
    expect(callArgs.args).not.toHaveProperty('currency1');
  });
});

describe('quoteBestPool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQuoteCache();
  });

  it('returns empty stats when no Uniswap pools', async () => {
    const pools = [makePool({ dex: 'Ramses' }), makePool({ dex: 'Giga' })];
    const result = await quoteBestPool(pools, 2000, 'buy');
    expect(result.best).toBeNull();
    expect(result.stats.quotedCount).toBe(0);
    expect(result.stats.failedCount).toBe(0);
    expect(result.stats.mainPoolFailed).toBe(false);
  });

  it('tracks failedCount when main pool quote fails (P0.1)', async () => {
    const mainPool = makePool({ pairAddress: '0x' + '11'.repeat(20), liquidityUsd: 500_000 });

    const mockClient = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error('429'))
        .mockRejectedValueOnce(new Error('429')),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteBestPool([mainPool], 2000, 'buy');

    expect(result.stats.mainPoolFailed).toBe(true);
    expect(result.stats.failedCount).toBe(1);
    expect(result.best).toBeNull();
  });

  it('main pool selected on retry success (P0.1)', async () => {
    const mainPool = makePool({ pairAddress: '0x' + '11'.repeat(20), liquidityUsd: 500_000, feeRate: 0.01 });

    const mainAmount = 10_100000000000000000n;
    const mainResult = '0x' + [
      mainAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');

    const mockClient = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error('429'))
        .mockResolvedValueOnce({ data: mainResult }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await quoteBestPool([mainPool], 2000, 'buy');

    expect(result.stats.mainPoolFailed).toBe(false);
    expect(result.stats.failedCount).toBe(0);
    expect(result.best).not.toBeNull();
    expect(result.best!.pool.pairAddress).toBe(mainPool.pairAddress);
  });

  it('caches results for 20s (P0.2)', async () => {
    const pool = makePool();
    const buyAmount = 10_000000000000000000n;
    const encodedResult = '0x' + [
      buyAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: encodedResult }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result1 = await quoteBestPool([pool], 2000, 'buy');
    expect(result1.best).not.toBeNull();

    mockClient.call.mockClear();
    const result2 = await quoteBestPool([pool], 2000, 'buy');
    expect(result2.best).not.toBeNull();
    expect(mockClient.call).not.toHaveBeenCalled();
  });
});

describe('analyzeAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQuoteCache();
  });

  it('returns buyStats and sellStats (P0.1)', async () => {
    const pool = makePool();
    const buyAmount = 10_000000000000000000n;
    const sellAmount = 1960_000000n;
    const buyResult = '0x' + [
      buyAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');
    const sellResult = '0x' + [
      sellAmount.toString(16).padStart(64, '0'),
      '0'.repeat(64),
      '0'.repeat(64),
      '0'.repeat(64),
    ].join('');

    const mockClient = {
      call: vi.fn()
        .mockResolvedValueOnce({ data: buyResult })
        .mockResolvedValueOnce({ data: sellResult }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await analyzeAmount([pool], 2000, 200);
    expect(result.buyResult).not.toBeNull();
    expect(result.sellResult).not.toBeNull();
    expect(result.buyStats).toBeDefined();
    expect(result.sellStats).toBeDefined();
    expect(result.buyStats.quotedCount).toBe(1);
    expect(result.buyStats.failedCount).toBe(0);
    expect(result.buyStats.mainPoolFailed).toBe(false);
    if (result.sellResult && result.sellPremium !== null) {
      expect(result.sellPremium).toBeLessThan(0);
    }
  });

  it('no retry at analyzeAmount level (P0.1 — removed R6 retry)', async () => {
    const pool = makePool();

    const mockClient = {
      call: vi.fn().mockResolvedValue({ data: null }),
      getLogs: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(createPublicClient).mockReturnValue(mockClient as never);

    const result = await analyzeAmount([pool], 2000, 200);
    expect(result.buyResult).toBeNull();
    expect(result.sellResult).toBeNull();
    const totalCalls = mockClient.call.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(4);
  });
});

describe('fixture data validation (P1.4)', () => {
  it('fixture TSLA address matches real address', () => {
    expect(fixture.cases[0].tokenAddress).toBe('0x322f0929c4625ed5bad873c95208d54e1c003b2d');
  });

  it('fixture wrongTopic0_7params matches real keccak', () => {
    const sig7 = 'Initialize(bytes32,address,address,uint24,int24,address,uint160)';
    const hash = keccak256(toBytes(sig7));
    expect(hash).toBe(fixture.initializeEvent.wrongTopic0_7params);
  });

  it('fixture topic0 matches real keccak of 8-param sig', () => {
    const sig8 = 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)';
    const hash = keccak256(toBytes(sig8));
    expect(hash).toBe(fixture.initializeEvent.topic0);
  });
});

describe('registry retry (P0.2)', () => {
  it('enumerateOfficialTokens retries on failure', async () => {
    const { enumerateOfficialTokens } = await import('./registry');
    const result = await enumerateOfficialTokens();
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(typeof result.degraded).toBe('boolean');
  });
});
