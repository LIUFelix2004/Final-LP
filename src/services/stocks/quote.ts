import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, parseAbiItem, type Address, type Hex } from 'viem';
import type { StockPool } from '../../types/stocks';
import { USDG_ADDRESS, USDG_DECIMALS, V3_QUOTER_V2, V4_QUOTER, V4_POOL_MANAGER_ROBINHOOD, ROBINHOOD_CHAIN_ID } from '../../config/stocks';
import { CHAINS } from '../../config/chains';

const STOCK_TOKEN_DECIMALS = 18;
const SANITY_THRESHOLD = 0.10;

const V3_QUOTE_ABI = [
  {
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'fee', type: 'uint24' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]}],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const V4_QUOTE_ABI = [
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

export const INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
);

const robinhoodChain = {
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'] },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const },
  },
} as const;

function getClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl),
  });
}

export interface AmountQuoteResult {
  pool: StockPool;
  direction: 'buy' | 'sell';
  amountIn: bigint;
  amountOut: bigint;
  effectivePrice: number;
  priceImpact: number;
  quotedVia: string;
}

export interface V4PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const V4_POOLKEY_CACHE_KEY = 'stocks-v4-poolkeys-v2';
const V4_POOLKEY_CACHE_TTL_MS = 3600_000;
const V4_MAX_CONCURRENCY = 3;

interface V4CacheEntry {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  timestamp: number;
}

function loadV4PoolKeyCacheForPool(poolId: string): V4PoolKey | null {
  try {
    const raw = localStorage.getItem(V4_POOLKEY_CACHE_KEY);
    if (!raw) return null;
    const data: Record<string, V4CacheEntry> = JSON.parse(raw);
    const entry = data[poolId.toLowerCase()];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > V4_POOLKEY_CACHE_TTL_MS) return null;
    return {
      currency0: entry.currency0 as Address,
      currency1: entry.currency1 as Address,
      fee: entry.fee,
      tickSpacing: entry.tickSpacing,
      hooks: entry.hooks as Address,
    };
  } catch {
    return null;
  }
}

function saveV4PoolKeyToCache(poolId: string, key: V4PoolKey): void {
  try {
    const raw = localStorage.getItem(V4_POOLKEY_CACHE_KEY);
    const data: Record<string, V4CacheEntry> = raw ? JSON.parse(raw) : {};
    data[poolId.toLowerCase()] = {
      currency0: key.currency0,
      currency1: key.currency1,
      fee: key.fee,
      tickSpacing: key.tickSpacing,
      hooks: key.hooks,
      timestamp: Date.now(),
    };
    localStorage.setItem(V4_POOLKEY_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

async function fetchV4PoolKeyForPool(poolId: string): Promise<V4PoolKey | null> {
  const cached = loadV4PoolKeyCacheForPool(poolId);
  if (cached) return cached;

  const client = getClient();
  const logs = await client.getLogs({
    address: V4_POOL_MANAGER_ROBINHOOD as Address,
    event: INITIALIZE_EVENT,
    args: { id: poolId as Hex },
    fromBlock: 0n,
  });

  if (logs.length === 0) return null;

  const log = logs[0];
  const args = log.args;
  if (!args.id || !args.currency0 || !args.currency1) return null;

  const key: V4PoolKey = {
    currency0: args.currency0,
    currency1: args.currency1,
    fee: args.fee ?? 0,
    tickSpacing: args.tickSpacing ?? 0,
    hooks: (args.hooks ?? '0x0000000000000000000000000000000000000000') as Address,
  };

  saveV4PoolKeyToCache(poolId, key);
  return key;
}

export async function fetchV4PoolKeys(poolIds: string[]): Promise<Map<string, V4PoolKey>> {
  const map = new Map<string, V4PoolKey>();
  const toFetch: string[] = [];

  for (const pid of poolIds) {
    const cached = loadV4PoolKeyCacheForPool(pid);
    if (cached) {
      map.set(pid.toLowerCase(), cached);
    } else {
      toFetch.push(pid);
    }
  }

  const queue = [...toFetch];
  const results: Array<{ poolId: string; key: V4PoolKey | null }> = [];

  async function worker() {
    while (queue.length > 0) {
      const poolId = queue.shift()!;
      try {
        const key = await fetchV4PoolKeyForPool(poolId);
        results.push({ poolId, key });
      } catch {
        results.push({ poolId, key: null });
      }
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(V4_MAX_CONCURRENCY, toFetch.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  for (const { poolId, key } of results) {
    if (key) map.set(poolId.toLowerCase(), key);
  }

  return map;
}

function feeToUint24(feeRate: number): number {
  return Math.round(feeRate * 10000);
}

function isSane(effectivePrice: number, midPrice: number | null): boolean {
  if (midPrice === null || midPrice === 0) return true;
  return Math.abs(effectivePrice / midPrice - 1) <= SANITY_THRESHOLD;
}

export async function quoteV3Pool(
  pool: StockPool,
  amountUsdg: number,
  direction: 'buy' | 'sell',
): Promise<AmountQuoteResult | null> {
  if (pool.version !== 'V3' || pool.dex !== 'Uniswap' || pool.feeRate === null) return null;

  const client = getClient();
  const fee = feeToUint24(pool.feeRate);
  const tokenAddr = pool.tokenAddress as Address;
  const usdgAddr = USDG_ADDRESS as Address;

  let tokenIn: Address;
  let tokenOut: Address;
  let amountIn: bigint;

  if (direction === 'buy') {
    tokenIn = usdgAddr;
    tokenOut = tokenAddr;
    amountIn = BigInt(Math.round(amountUsdg * 10 ** USDG_DECIMALS));
  } else {
    if (pool.priceNative === null || pool.priceNative === 0) return null;
    const tokenAmount = amountUsdg / pool.priceNative;
    tokenIn = tokenAddr;
    tokenOut = usdgAddr;
    amountIn = BigInt(Math.round(tokenAmount * 10 ** STOCK_TOKEN_DECIMALS));
  }

  try {
    const data = encodeFunctionData({
      abi: V3_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });

    const result = await client.call({
      to: V3_QUOTER_V2 as Address,
      data,
    });

    if (!result.data) return null;

    const decoded = decodeFunctionResult({
      abi: V3_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      data: result.data,
    });

    const amountOut = decoded[0];
    let effectivePrice: number;

    if (direction === 'buy') {
      const tokensOut = Number(amountOut) / 10 ** STOCK_TOKEN_DECIMALS;
      if (tokensOut === 0) return null;
      effectivePrice = amountUsdg / tokensOut;
    } else {
      const usdgOut = Number(amountOut) / 10 ** USDG_DECIMALS;
      effectivePrice = usdgOut / (Number(amountIn) / 10 ** STOCK_TOKEN_DECIMALS);
    }

    if (!isSane(effectivePrice, pool.priceNative)) return null;

    const midPrice = pool.priceNative ?? effectivePrice;
    const priceImpact = midPrice > 0 ? (effectivePrice - midPrice) / midPrice : 0;

    return {
      pool,
      direction,
      amountIn,
      amountOut,
      effectivePrice,
      priceImpact: direction === 'buy' ? priceImpact : -priceImpact,
      quotedVia: `Uniswap V3 ${pool.feeRate.toFixed(2)}%`,
    };
  } catch {
    return null;
  }
}

export async function quoteV4Pool(
  pool: StockPool,
  poolKey: V4PoolKey,
  amountUsdg: number,
  direction: 'buy' | 'sell',
): Promise<AmountQuoteResult | null> {
  const client = getClient();
  const usdgAddr = USDG_ADDRESS.toLowerCase() as Address;

  const usdgIsCurrency0 = poolKey.currency0.toLowerCase() === usdgAddr;

  let zeroForOne: boolean;
  let amountIn: bigint;

  if (direction === 'buy') {
    zeroForOne = usdgIsCurrency0;
    amountIn = BigInt(Math.round(amountUsdg * 10 ** USDG_DECIMALS));
  } else {
    if (pool.priceNative === null || pool.priceNative === 0) return null;
    const tokenAmount = amountUsdg / pool.priceNative;
    zeroForOne = !usdgIsCurrency0;
    amountIn = BigInt(Math.round(tokenAmount * 10 ** STOCK_TOKEN_DECIMALS));
  }

  try {
    const data = encodeFunctionData({
      abi: V4_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: poolKey.currency0,
          currency1: poolKey.currency1,
          fee: poolKey.fee,
          tickSpacing: poolKey.tickSpacing,
          hooks: poolKey.hooks,
        },
        zeroForOne,
        exactAmount: amountIn,
        hookData: '0x' as Hex,
      }],
    });

    const result = await client.call({
      to: V4_QUOTER as Address,
      data,
    });

    if (!result.data) return null;

    const decoded = decodeFunctionResult({
      abi: V4_QUOTE_ABI,
      functionName: 'quoteExactInputSingle',
      data: result.data,
    });

    const amountOut = decoded[0] as bigint;
    if (amountOut <= 0n) return null;

    let effectivePrice: number;
    if (direction === 'buy') {
      const tokensOut = Number(amountOut) / 10 ** STOCK_TOKEN_DECIMALS;
      if (tokensOut === 0) return null;
      effectivePrice = amountUsdg / tokensOut;
    } else {
      const usdgOut = Number(amountOut) / 10 ** USDG_DECIMALS;
      effectivePrice = usdgOut / (Number(amountIn) / 10 ** STOCK_TOKEN_DECIMALS);
    }

    if (!isSane(effectivePrice, pool.priceNative)) return null;

    const midPrice = pool.priceNative ?? effectivePrice;
    const priceImpact = midPrice > 0 ? (effectivePrice - midPrice) / midPrice : 0;

    const feeLabel = (poolKey.fee & 0x800000) ? '动态费' : `${(poolKey.fee / 10000).toFixed(2)}%`;

    return {
      pool,
      direction,
      amountIn,
      amountOut,
      effectivePrice,
      priceImpact: direction === 'buy' ? priceImpact : -priceImpact,
      quotedVia: `Uniswap V4 ${feeLabel}`,
    };
  } catch {
    return null;
  }
}

export async function quoteBestPool(
  pools: StockPool[],
  amountUsdg: number,
  direction: 'buy' | 'sell',
): Promise<AmountQuoteResult | null> {
  const uniPools = pools.filter(p => p.dex === 'Uniswap');
  if (uniPools.length === 0) return null;

  const v3Pools = uniPools.filter(p => p.version === 'V3' && p.feeRate !== null);
  const v4Pools = uniPools.filter(p => p.version === 'V4');

  let v4KeyMap: Map<string, V4PoolKey> | null = null;
  if (v4Pools.length > 0) {
    try {
      v4KeyMap = await fetchV4PoolKeys(v4Pools.map(p => p.pairAddress));
    } catch {
      v4KeyMap = null;
    }
  }

  const quotePromises: Promise<AmountQuoteResult | null>[] = [
    ...v3Pools.map(p => quoteV3Pool(p, amountUsdg, direction)),
  ];

  if (v4KeyMap) {
    for (const p of v4Pools) {
      const poolId = p.pairAddress.toLowerCase();
      const key = v4KeyMap.get(poolId);
      if (key) {
        quotePromises.push(quoteV4Pool(p, key, amountUsdg, direction));
      }
    }
  }

  if (quotePromises.length === 0) return null;

  const results = await Promise.all(quotePromises);
  const valid = results.filter((r): r is AmountQuoteResult => r !== null);
  if (valid.length === 0) return null;

  if (direction === 'buy') {
    return valid.reduce((best, r) => r.effectivePrice < best.effectivePrice ? r : best);
  } else {
    return valid.reduce((best, r) => r.effectivePrice > best.effectivePrice ? r : best);
  }
}

export interface AmountAnalysis {
  buyResult: AmountQuoteResult | null;
  sellResult: AmountQuoteResult | null;
  buyPremium: number | null;
  sellPremium: number | null;
  midPrice: number | null;
}

export async function analyzeAmount(
  pools: StockPool[],
  amountUsdg: number,
  fairPrice: number | null,
): Promise<AmountAnalysis> {
  let [buyResult, sellResult] = await Promise.all([
    quoteBestPool(pools, amountUsdg, 'buy'),
    quoteBestPool(pools, amountUsdg, 'sell'),
  ]);

  if (!buyResult) buyResult = await quoteBestPool(pools, amountUsdg, 'buy');
  if (!sellResult) sellResult = await quoteBestPool(pools, amountUsdg, 'sell');

  const midPrice = fairPrice;

  const buyPremium = buyResult && midPrice
    ? (buyResult.effectivePrice - midPrice) / midPrice
    : null;

  const sellPremium = sellResult && midPrice
    ? sellResult.effectivePrice / midPrice - 1
    : null;

  return { buyResult, sellResult, buyPremium, sellPremium, midPrice };
}
