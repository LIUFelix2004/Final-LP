import type { StockPool, StockToken, StockFeeRow } from '../../types/stocks';
import { USDG_ADDRESS, MIN_POOL_LIQUIDITY, MIN_POOL_VOLUME_24H, MAX_POOLS_PER_STOCK, POOL_CACHE_TTL_MS } from '../../config/stocks';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const DEXSCREENER_TOKEN_PAIRS = `${DEXSCREENER_API}/token-pairs/v1/robinhood`;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const dsRateLimit = { tokens: 200, lastRefill: Date.now(), maxTokens: 200, refillRate: 200 / 60_000 };
export const dsGlobalPause = { until: 0, backoffMs: 30_000 };
export let dsRetryPending = 0;

async function waitForDsToken(): Promise<void> {
  if (Date.now() < dsGlobalPause.until) {
    const waitMs = dsGlobalPause.until - Date.now();
    await sleep(waitMs);
  }
  const now = Date.now();
  const elapsed = now - dsRateLimit.lastRefill;
  dsRateLimit.tokens = Math.min(dsRateLimit.maxTokens, dsRateLimit.tokens + elapsed * dsRateLimit.refillRate);
  dsRateLimit.lastRefill = now;
  if (dsRateLimit.tokens < 1) {
    const waitMs = (1 - dsRateLimit.tokens) / dsRateLimit.refillRate;
    await sleep(waitMs);
    dsRateLimit.tokens = 0;
    dsRateLimit.lastRefill = Date.now();
  }
  dsRateLimit.tokens -= 1;
}

function on429() {
  dsGlobalPause.until = Date.now() + dsGlobalPause.backoffMs;
  dsGlobalPause.backoffMs = Math.min(dsGlobalPause.backoffMs * 2, 120_000);
}

function onSuccess() {
  dsGlobalPause.backoffMs = 30_000;
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  await waitForDsToken();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      dsRetryPending = attempt > 0 ? dsRetryPending + 1 : dsRetryPending;
      const resp = await fetch(url);
      if (resp.ok) { onSuccess(); if (attempt > 0) dsRetryPending = Math.max(0, dsRetryPending - 1); return resp; }
      if (resp.status === 429) {
        on429();
        lastError = new Error(`HTTP 429`);
        if (attempt < maxRetries) {
          await waitForDsToken();
          continue;
        }
      } else if (resp.status >= 500) {
        lastError = new Error(`HTTP ${resp.status}`);
        if (attempt < maxRetries) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
          await waitForDsToken();
          continue;
        }
      }
      throw new Error(`DexScreener returned ${resp.status}`);
    } catch (err) {
      if (err instanceof TypeError) {
        on429();
        lastError = new Error('DexScreener CORS/网络错误 (视为 429)');
        if (attempt < maxRetries) {
          await waitForDsToken();
          continue;
        }
      } else {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
          await waitForDsToken();
        }
      }
    }
  }
  throw lastError ?? new Error('All retries exhausted');
}

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  labels?: string[];
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceNative?: string;
  priceUsd?: string;
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
}

function mapVersion(dexId: string, labels?: string[]): 'V2' | 'V3' | 'V4' {
  if (labels && labels.length > 0) {
    const joined = labels.map(l => l.toLowerCase()).join(' ');
    if (joined.includes('v4')) return 'V4';
    if (joined.includes('v3') || joined.includes('cl') || joined.includes('clmm')) return 'V3';
    if (joined.includes('v2')) return 'V2';
  }
  const id = dexId.toLowerCase();
  if (id.includes('v4')) return 'V4';
  if (id.includes('v3') || id.includes('cl') || id.includes('slipstream')) return 'V3';
  return 'V2';
}

function mapDexName(dexId: string): string {
  const id = dexId.toLowerCase();
  if (id.startsWith('uniswap')) return 'Uniswap';
  if (id === 'up' || id.startsWith('up_') || id.includes('up33') || id.includes('aerodrome') || id.includes('velodrome')) return 'UP33';
  if (id.startsWith('sushiswap')) return 'SushiSwap';
  if (id.startsWith('ramses')) return 'Ramses';
  if (id.startsWith('giga')) return 'Giga';
  if (id.startsWith('alandale')) return 'Alandale';
  if (id.startsWith('kittenswap')) return 'KittenSwap';
  return dexId;
}

function pairToStockPool(pair: DsPair, tokenAddress: string): StockPool | null {
  if (pair.chainId !== 'robinhood') return null;

  const baseAddr = pair.baseToken.address.toLowerCase();
  const quoteAddr = pair.quoteToken.address.toLowerCase();
  const tokenAddr = tokenAddress.toLowerCase();
  const usdgAddr = USDG_ADDRESS.toLowerCase();

  const isBaseUsdg = baseAddr === usdgAddr && quoteAddr === tokenAddr;
  const isQuoteUsdg = quoteAddr === usdgAddr && baseAddr === tokenAddr;

  if (!isBaseUsdg && !isQuoteUsdg) return null;

  let priceNative = safeNum(pair.priceNative);
  if (isBaseUsdg && priceNative !== null && priceNative > 0) {
    priceNative = 1 / priceNative;
  }

  return {
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    dex: mapDexName(pair.dexId),
    labels: pair.labels ?? [],
    version: mapVersion(pair.dexId, pair.labels),
    tokenAddress,
    tokenSymbol: isBaseUsdg ? pair.quoteToken.symbol : pair.baseToken.symbol,
    isBaseUsdg,
    priceNative,
    priceUsd: safeNum(pair.priceUsd),
    liquidityUsd: pair.liquidity?.usd ?? null,
    feeRate: null,
    feeRateInferred: false,
    volume: {
      m5: pair.volume?.m5 ?? null,
      h1: pair.volume?.h1 ?? null,
      h6: pair.volume?.h6 ?? null,
      h24: pair.volume?.h24 ?? null,
    },
  };
}

export async function discoverPoolsForToken(
  token: StockToken,
  signal?: AbortSignal,
): Promise<StockPool[]> {
  const pools: StockPool[] = [];
  const seen = new Set<string>();

  const resp = await fetchWithRetry(`${DEXSCREENER_TOKEN_PAIRS}/${token.address}`);
  if (signal?.aborted) return [];
  const pairs: DsPair[] = await resp.json();

  for (const pair of pairs) {
    const pool = pairToStockPool(pair, token.address);
    if (pool && !seen.has(pool.pairAddress)) {
      seen.add(pool.pairAddress);
      pools.push(pool);
    }
  }

  if (pairs.length >= 30) {
    await sleep(200);
    if (signal?.aborted) return pools;
    try {
      const searchResp = await fetchWithRetry(
        `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(token.symbol + ' USDG')}`,
      );
      const searchData = await searchResp.json();
      for (const pair of (searchData.pairs ?? []) as DsPair[]) {
        const pool = pairToStockPool(pair, token.address);
        if (pool && !seen.has(pool.pairAddress)) {
          seen.add(pool.pairAddress);
          pools.push(pool);
        }
      }
    } catch { /* search supplement is best-effort */ }
  }

  return filterAndSortPools(pools);
}

const DEXSCREENER_BATCH_API = `${DEXSCREENER_API}/tokens/v1/robinhood`;
const DS_BATCH_SIZE = 30;

export async function discoverPoolsBatch(
  tokens: StockToken[],
  signal?: AbortSignal,
  onProgress?: (current: number, total: number) => void,
): Promise<Map<string, StockPool[]>> {
  const result = new Map<string, StockPool[]>();

  for (let i = 0; i < tokens.length; i += DS_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = tokens.slice(i, i + DS_BATCH_SIZE);
    const addresses = batch.map(t => t.address).join(',');

    try {
      const resp = await fetchWithRetry(`${DEXSCREENER_BATCH_API}/${addresses}`);
      if (signal?.aborted) break;
      const pairs: DsPair[] = await resp.json();

      for (const token of batch) {
        const pools: StockPool[] = [];
        const seen = new Set<string>();
        for (const pair of pairs) {
          const pool = pairToStockPool(pair, token.address);
          if (pool && !seen.has(pool.pairAddress)) {
            seen.add(pool.pairAddress);
            pools.push(pool);
          }
        }
        result.set(token.address.toLowerCase(), filterAndSortPools(pools));
      }
    } catch {
      for (const token of batch) {
        if (signal?.aborted) break;
        try {
          const pools = await discoverPoolsForToken(token, signal);
          result.set(token.address.toLowerCase(), pools);
        } catch { /* individual also failed */ }
      }
    }

    onProgress?.(Math.min(i + DS_BATCH_SIZE, tokens.length), tokens.length);
    if (i + DS_BATCH_SIZE < tokens.length) await sleep(200);
  }

  return result;
}

function filterAndSortPools(pools: StockPool[]): StockPool[] {
  return pools
    .filter(p =>
      (p.liquidityUsd !== null && p.liquidityUsd >= MIN_POOL_LIQUIDITY) ||
      (p.volume.h24 !== null && p.volume.h24 >= MIN_POOL_VOLUME_24H)
    )
    .sort((a, b) => (b.volume.h24 ?? 0) - (a.volume.h24 ?? 0))
    .slice(0, MAX_POOLS_PER_STOCK);
}

export function selectMainPool(pools: StockPool[]): StockPool | null {
  if (pools.length === 0) return null;
  return pools.reduce((best, p) =>
    (p.liquidityUsd ?? 0) > (best.liquidityUsd ?? 0) ? p : best
  );
}

export function getOnchainPrice(mainPool: StockPool | null): number | null {
  if (!mainPool) return null;
  return mainPool.priceNative;
}

export function computeTickerFee(
  pools: StockPool[],
  window: 'm5' | 'h1' | 'h6' | 'h24',
): { fee: number | null; unknownCount: number; unknownVolume: number } {
  let total = 0;
  let hasAny = false;
  let unknownCount = 0;
  let unknownVolume = 0;

  for (const pool of pools) {
    const vol = pool.volume[window];
    if (vol === null || vol === 0) continue;
    if (pool.feeRate !== null) {
      total += vol * (pool.feeRate / 100);
      hasAny = true;
    } else {
      unknownCount++;
      unknownVolume += vol;
    }
  }

  return { fee: hasAny ? total : null, unknownCount, unknownVolume };
}

export function buildFeeRow(
  token: StockToken,
  pools: StockPool[],
): StockFeeRow {
  const mainPool = selectMainPool(pools);
  const onchainPrice = getOnchainPrice(mainPool);

  const feeM5 = computeTickerFee(pools, 'm5');
  const feeH1 = computeTickerFee(pools, 'h1');
  const feeH6 = computeTickerFee(pools, 'h6');
  const feeH24 = computeTickerFee(pools, 'h24');

  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    pools,
    mainPool,
    onchainPrice,
    fee: {
      m5: feeM5.fee,
      h1: feeH1.fee,
      h6: feeH6.fee,
      h24: feeH24.fee,
    },
    feeUnknownCount: feeH24.unknownCount,
    feeUnknownVolume24h: feeH24.unknownVolume,
  };
}

export async function refreshPoolPrices(
  allPools: StockPool[],
): Promise<Map<string, DsPair>> {
  const updated = new Map<string, DsPair>();
  const addresses = allPools.map(p => p.pairAddress);

  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    try {
      const resp = await fetchWithRetry(
        `${DEXSCREENER_API}/latest/dex/pairs/robinhood/${batch.join(',')}`,
      );
      const data = await resp.json();
      for (const pair of (data.pairs ?? []) as DsPair[]) {
        updated.set(pair.pairAddress, pair);
      }
    } catch { /* partial failure OK */ }
    if (i + 30 < addresses.length) await sleep(200);
  }

  return updated;
}

export function updatePoolsFromPairs(
  pools: StockPool[],
  pairMap: Map<string, DsPair>,
  tokenAddress: string,
): StockPool[] {
  return pools.map(pool => {
    const pair = pairMap.get(pool.pairAddress);
    if (!pair) return pool;
    const updated = pairToStockPool(pair, tokenAddress);
    if (!updated) return pool;
    return { ...updated, feeRate: pool.feeRate, feeRateInferred: pool.feeRateInferred };
  });
}

const POOL_CACHE_KEY = 'stocks-pools-v1';

interface PoolCacheEntry {
  tokenAddress: string;
  pools: StockPool[];
  timestamp: number;
}

export function loadPoolCache(): Map<string, PoolCacheEntry> {
  try {
    const raw = localStorage.getItem(POOL_CACHE_KEY);
    if (!raw) return new Map();
    const entries: PoolCacheEntry[] = JSON.parse(raw);
    const now = Date.now();
    const map = new Map<string, PoolCacheEntry>();
    for (const e of entries) {
      if (now - e.timestamp < POOL_CACHE_TTL_MS) {
        map.set(e.tokenAddress.toLowerCase(), e);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export function savePoolCache(cache: Map<string, PoolCacheEntry>): void {
  try {
    localStorage.setItem(POOL_CACHE_KEY, JSON.stringify([...cache.values()]));
  } catch { /* quota exceeded */ }
}
