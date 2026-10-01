import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, parseAbiItem, type Address, type Hex } from 'viem';
import type { StockPool } from '../../types/stocks';
import { USDG_ADDRESS, USDG_DECIMALS, V3_QUOTER_V2, V4_QUOTER, V4_POOL_MANAGER_ROBINHOOD, V4_POOL_MANAGER_DEPLOY_BLOCK, ROBINHOOD_CHAIN_ID } from '../../config/stocks';
import { CHAINS } from '../../config/chains';

import { rpcThrottled } from './rpcLimiter';
export { rpcThrottled };

const STOCK_TOKEN_DECIMALS = 18;
const SANITY_THRESHOLD = 0.10;
const V4_KEY_SEGMENT_SIZE = 10_000_000n;
const V4_OR_SEGMENT_SIZE = 100_000n;

const negativeCache = new Map<string, number>();
const NEGATIVE_CACHE_TTL = 5 * 60 * 1000;

function isNegativelyCached(poolId: string): boolean {
  const ts = negativeCache.get(poolId.toLowerCase());
  if (!ts) return false;
  if (Date.now() - ts > NEGATIVE_CACHE_TTL) {
    negativeCache.delete(poolId.toLowerCase());
    return false;
  }
  return true;
}

const v4InFlightQueries = new Map<string, Promise<V4PoolKey | null>>();

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

export interface QuoteStats {
  quotedCount: number;
  failedCount: number;
  failedPools: string[];
  failedReasons: string[];
  mainPoolFailed: boolean;
}

export interface BestPoolResult {
  best: AmountQuoteResult | null;
  stats: QuoteStats;
}

export interface V4PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const V4_POOLKEY_CACHE_KEY = 'stocks-v4-poolkeys-v2';
interface V4CacheEntry {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  timestamp: number;
}

function isBlockRangeError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('-32602') || msg.includes('query spans') || msg.includes('block range');
}

interface V4SnapshotData {
  keys: Map<string, V4PoolKey>;
  block: bigint;
}

let v4SnapshotData: V4SnapshotData | null = null;
let v4SnapshotLoading: Promise<V4SnapshotData> | null = null;

async function ensureV4Snapshot(): Promise<V4SnapshotData> {
  if (v4SnapshotData) return v4SnapshotData;
  if (!v4SnapshotLoading) {
    v4SnapshotLoading = (async () => {
      try {
        const resp = await fetch('/v4-poolkeys.json');
        if (!resp.ok) throw new Error(`${resp.status}`);
        const json = await resp.json();
        const keys = new Map<string, V4PoolKey>();
        for (const [poolId, entry] of Object.entries(json.keys ?? {})) {
          const e = entry as { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
          keys.set(poolId.toLowerCase(), {
            currency0: e.currency0 as Address,
            currency1: e.currency1 as Address,
            fee: e.fee,
            tickSpacing: e.tickSpacing,
            hooks: e.hooks as Address,
          });
        }
        const block = keys.size > 0 ? BigInt(json.snapshotBlock || 0) : 0n;
        v4SnapshotData = { keys, block };
        return v4SnapshotData;
      } catch {
        v4SnapshotData = { keys: new Map(), block: 0n };
        return v4SnapshotData;
      }
    })();
  }
  return v4SnapshotLoading;
}

export function resetV4Snapshot(): void {
  v4SnapshotData = null;
  v4SnapshotLoading = null;
}

async function loadV4PoolKeyCacheForPool(poolId: string): Promise<V4PoolKey | null> {
  const snap = await ensureV4Snapshot();
  const snapKey = snap.keys.get(poolId.toLowerCase());
  if (snapKey) return snapKey;

  try {
    const raw = localStorage.getItem(V4_POOLKEY_CACHE_KEY);
    if (!raw) return null;
    const data: Record<string, V4CacheEntry> = JSON.parse(raw);
    const entry = data[poolId.toLowerCase()];
    if (!entry) return null;
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
  const cached = await loadV4PoolKeyCacheForPool(poolId);
  if (cached) return cached;
  if (isNegativelyCached(poolId)) return null;

  const existing = v4InFlightQueries.get(poolId.toLowerCase());
  if (existing) return existing;

  const promise = (async (): Promise<V4PoolKey | null> => {
    const client = getClient();
    const currentBlock = await client.getBlockNumber();
    const snap = await ensureV4Snapshot();
    const fromBlock = snap.block > 0n ? snap.block + 1n : V4_POOL_MANAGER_DEPLOY_BLOCK;

    let cursor = fromBlock;
    while (cursor <= currentBlock) {
      const end = cursor + V4_KEY_SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + V4_KEY_SEGMENT_SIZE - 1n;
      try {
        const logs = await rpcThrottled(() => client.getLogs({
          address: V4_POOL_MANAGER_ROBINHOOD as Address,
          event: INITIALIZE_EVENT,
          args: { id: poolId as Hex },
          fromBlock: cursor,
          toBlock: end,
        }));

        if (logs.length > 0) {
          const args = logs[0].args;
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
      } catch (err) {
        if (isBlockRangeError(err) && (end - cursor) > 1_000_000n) {
          const mid = cursor + (end - cursor) / 2n;
          const logs1 = await rpcThrottled(() => client.getLogs({
            address: V4_POOL_MANAGER_ROBINHOOD as Address,
            event: INITIALIZE_EVENT,
            args: { id: poolId as Hex },
            fromBlock: cursor,
            toBlock: mid,
          }));
          if (logs1.length > 0) {
            const args = logs1[0].args;
            if (args.id && args.currency0 && args.currency1) {
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
          }
          cursor = mid + 1n;
          continue;
        }
        throw err;
      }
      cursor = end + 1n;
    }

    negativeCache.set(poolId.toLowerCase(), Date.now());
    return null;
  })();

  v4InFlightQueries.set(poolId.toLowerCase(), promise);
  try {
    return await promise;
  } finally {
    v4InFlightQueries.delete(poolId.toLowerCase());
  }
}

export async function fetchV4PoolKeys(poolIds: string[]): Promise<Map<string, V4PoolKey>> {
  const map = new Map<string, V4PoolKey>();
  const toFetch: string[] = [];

  for (const pid of poolIds) {
    const cached = await loadV4PoolKeyCacheForPool(pid);
    if (cached) {
      map.set(pid.toLowerCase(), cached);
    } else if (!isNegativelyCached(pid)) {
      toFetch.push(pid);
    }
  }

  if (toFetch.length === 0) return map;

  const client = getClient();
  const currentBlock = await client.getBlockNumber();
  const snap = await ensureV4Snapshot();
  const fromBlock = snap.block > 0n ? snap.block : V4_POOL_MANAGER_DEPLOY_BLOCK;
  const span = currentBlock - fromBlock;
  const useOrQuery = span <= V4_OR_SEGMENT_SIZE;

  const BATCH_SIZE = 20;
  for (let b = 0; b < toFetch.length; b += BATCH_SIZE) {
    const batchIds = toFetch.slice(b, b + BATCH_SIZE);

    if (useOrQuery) {
      let cursor = fromBlock;
      while (cursor <= currentBlock) {
        const end = cursor + V4_OR_SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + V4_OR_SEGMENT_SIZE - 1n;
        try {
          const logs = await rpcThrottled(() => client.getLogs({
            address: V4_POOL_MANAGER_ROBINHOOD as Address,
            event: INITIALIZE_EVENT,
            args: { id: batchIds.map(id => id as Hex) },
            fromBlock: cursor,
            toBlock: end,
          }));

          for (const log of logs) {
            const args = log.args;
            if (!args.id || !args.currency0 || !args.currency1) continue;
            const pid = args.id.toLowerCase();
            if (map.has(pid)) continue;

            const key: V4PoolKey = {
              currency0: args.currency0,
              currency1: args.currency1,
              fee: args.fee ?? 0,
              tickSpacing: args.tickSpacing ?? 0,
              hooks: (args.hooks ?? '0x0000000000000000000000000000000000000000') as Address,
            };
            map.set(pid, key);
            saveV4PoolKeyToCache(pid, key);
          }
        } catch (err) {
          if (isBlockRangeError(err)) {
            for (const pid of batchIds) {
              if (!map.has(pid.toLowerCase())) {
                try {
                  const key = await fetchV4PoolKeyForPool(pid);
                  if (key) map.set(pid.toLowerCase(), key);
                } catch { /* individual fallback failed */ }
              }
            }
            break;
          }
          throw err;
        }
        cursor = end + 1n;
      }
    } else {
      for (const pid of batchIds) {
        if (!map.has(pid.toLowerCase())) {
          try {
            const key = await fetchV4PoolKeyForPool(pid);
            if (key) map.set(pid.toLowerCase(), key);
          } catch { /* individual fetch failed */ }
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
  }

  for (const pid of toFetch) {
    if (!map.has(pid.toLowerCase())) {
      negativeCache.set(pid.toLowerCase(), Date.now());
    }
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
  if (pool.version !== 'V3' || pool.dex !== 'Uniswap' || pool.feeRate === null || pool.feeRateInferred) return null;

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

const QUOTE_CACHE_TTL_MS = 20_000;
const quoteCache = new Map<string, { result: BestPoolResult; timestamp: number }>();

function poolSignature(pool: StockPool): string {
  const fee = pool.feeRate !== null && !pool.feeRateInferred ? pool.feeRate.toFixed(4) : '?';
  return `${pool.pairAddress}:${fee}:${pool.version}`;
}

function getQuoteCacheKey(pools: StockPool[], amountUsdg: number, direction: string): string {
  const token = pools[0]?.tokenAddress ?? '';
  const sig = pools.map(poolSignature).sort().join('|');
  return `${token}:${amountUsdg}:${direction}:${sig}`;
}

export function clearQuoteCache(): void {
  quoteCache.clear();
}

const QUOTE_CONCURRENCY = 3;

export async function quoteBestPool(
  pools: StockPool[],
  amountUsdg: number,
  direction: 'buy' | 'sell',
  onProgress?: (done: number, total: number) => void,
): Promise<BestPoolResult> {
  const emptyStats: QuoteStats = { quotedCount: 0, failedCount: 0, failedPools: [], failedReasons: [], mainPoolFailed: false };

  const uniPools = pools.filter(p => p.dex === 'Uniswap');
  if (uniPools.length === 0) return { best: null, stats: emptyStats };

  const cacheKey = getQuoteCacheKey(pools, amountUsdg, direction);
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL_MS) {
    onProgress?.(1, 1);
    return cached.result;
  }

  const v3Pools = uniPools.filter(p => p.version === 'V3' && p.feeRate !== null && !p.feeRateInferred);
  const v3FeeUnknown = uniPools.filter(p => p.version === 'V3' && (p.feeRate === null || p.feeRateInferred));
  const v4Pools = uniPools.filter(p => p.version === 'V4');

  const mainPool = uniPools.reduce((best, p) =>
    (p.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0) ? p : best
  );

  let v4KeyMap: Map<string, V4PoolKey> | null = null;
  if (v4Pools.length > 0) {
    try {
      v4KeyMap = await fetchV4PoolKeys(v4Pools.map(p => p.pairAddress));
    } catch {
      v4KeyMap = null;
    }
  }

  const preFailures: Array<{ pool: StockPool; reason: string }> = [];
  for (const p of v3FeeUnknown) {
    preFailures.push({ pool: p, reason: '费率未知' });
  }

  const tasks: Array<{ pool: StockPool; quoteFn: () => Promise<AmountQuoteResult | null> }> = [
    ...v3Pools.map(p => ({ pool: p, quoteFn: () => quoteV3Pool(p, amountUsdg, direction) })),
  ];

  for (const p of v4Pools) {
    const key = v4KeyMap?.get(p.pairAddress.toLowerCase());
    if (key) {
      tasks.push({ pool: p, quoteFn: () => quoteV4Pool(p, key, amountUsdg, direction) });
    } else {
      preFailures.push({ pool: p, reason: '缺少 V4 key' });
    }
  }

  const totalPools = tasks.length + preFailures.length;
  if (totalPools === 0) return { best: null, stats: emptyStats };

  let done = 0;
  const firstResults: Array<AmountQuoteResult | null> = new Array(tasks.length).fill(null);

  if (tasks.length > 0) {
    const queue = tasks.map((_, i) => i);
    async function worker() {
      while (queue.length > 0) {
        const idx = queue.shift()!;
        firstResults[idx] = await tasks[idx].quoteFn();
        done++;
        onProgress?.(done + preFailures.length, totalPools);
      }
    }
    const workerCount = Math.min(QUOTE_CONCURRENCY, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const needsRetry: number[] = [];
    for (let i = 0; i < firstResults.length; i++) {
      if (firstResults[i] === null) needsRetry.push(i);
    }

    if (needsRetry.length > 0) {
      await Promise.all(needsRetry.map(async (idx) => {
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        firstResults[idx] = await tasks[idx].quoteFn();
      }));
    }
  }

  let quotedCount = 0;
  let failedCount = 0;
  const failedPools: string[] = [];
  const failedReasons: string[] = [];
  const valid: AmountQuoteResult[] = [];

  for (let i = 0; i < firstResults.length; i++) {
    if (firstResults[i] !== null) {
      quotedCount++;
      valid.push(firstResults[i]!);
    } else {
      failedCount++;
      failedPools.push(tasks[i].pool.pairAddress);
      failedReasons.push('报价失败');
    }
  }

  for (const { pool, reason } of preFailures) {
    failedCount++;
    failedPools.push(pool.pairAddress);
    failedReasons.push(reason);
  }

  const mainPoolFailed = failedPools.some(addr =>
    addr.toLowerCase() === mainPool.pairAddress.toLowerCase()
  );

  const stats: QuoteStats = { quotedCount, failedCount, failedPools, failedReasons, mainPoolFailed };

  if (valid.length === 0) {
    return { best: null, stats };
  }

  const best = direction === 'buy'
    ? valid.reduce((b, r) => r.effectivePrice < b.effectivePrice ? r : b)
    : valid.reduce((b, r) => r.effectivePrice > b.effectivePrice ? r : b);

  const result: BestPoolResult = { best, stats };
  if (!stats.mainPoolFailed) {
    quoteCache.set(cacheKey, { result, timestamp: Date.now() });
  }
  return result;
}

export interface AmountAnalysis {
  buyResult: AmountQuoteResult | null;
  sellResult: AmountQuoteResult | null;
  buyPremium: number | null;
  sellPremium: number | null;
  midPrice: number | null;
  buyStats: QuoteStats;
  sellStats: QuoteStats;
}

export async function analyzeAmount(
  pools: StockPool[],
  amountUsdg: number,
  fairPrice: number | null,
  onProgress?: (msg: string) => void,
): Promise<AmountAnalysis> {
  const emptyStats: QuoteStats = { quotedCount: 0, failedCount: 0, failedPools: [], failedReasons: [], mainPoolFailed: false };

  const [buyPoolResult, sellPoolResult] = await Promise.all([
    quoteBestPool(pools, amountUsdg, 'buy', (done, total) =>
      onProgress?.(`已报价 ${done}/${total} 池（买入）`),
    ),
    quoteBestPool(pools, amountUsdg, 'sell', (done, total) =>
      onProgress?.(`已报价 ${done}/${total} 池（卖出）`),
    ),
  ]);

  const buyResult = buyPoolResult.best;
  const sellResult = sellPoolResult.best;
  const buyStats = buyPoolResult.stats ?? emptyStats;
  const sellStats = sellPoolResult.stats ?? emptyStats;

  const midPrice = fairPrice;

  const buyPremium = buyResult && midPrice
    ? (buyResult.effectivePrice - midPrice) / midPrice
    : null;

  const sellPremium = sellResult && midPrice
    ? sellResult.effectivePrice / midPrice - 1
    : null;

  return { buyResult, sellResult, buyPremium, sellPremium, midPrice, buyStats, sellStats };
}
