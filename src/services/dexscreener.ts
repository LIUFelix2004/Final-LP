import type { PoolData } from '../types';
import { computeFeeTvlRatio } from '../utils/format';

const DEXSCREENER_API = 'https://api.dexscreener.com';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceUsd: string | null;
  volume: { h24: number };
  txns: { h24: { buys: number; sells: number } };
  liquidity: { usd: number };
  fdv: number | null;
  pairCreatedAt: number;
}

export const CHAIN_SLUG: Record<number, string> = {
  56: 'bsc',
  4663: 'robinhood',
};

const DISCOVERY_TOKENS: Record<number, string[]> = {
  56: [
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
  ],
  4663: [
    '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', // WETH
    '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', // USDG
    '0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31', // VIRTUAL
    '0x57C0E45cB534413D1C20A4240955d6bB250BB4F1', // UP
  ],
};

const SEARCH_QUERIES: Record<number, string[]> = {
  56: ['WBNB USDT', 'CAKE BNB', 'USDC USDT'],
  4663: ['WETH USDG', 'UP WETH', 'VIRTUAL WETH'],
};

export class FetchError extends Error {
  statusCode: number | undefined;
  retriable: boolean;

  constructor(message: string, statusCode?: number, retriable = false) {
    super(message);
    this.name = 'FetchError';
    this.statusCode = statusCode;
    this.retriable = retriable;
  }
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return resp;

      if (resp.status === 429 || resp.status >= 500) {
        lastError = new FetchError(
          `HTTP ${resp.status} from DexScreener`,
          resp.status,
          true,
        );
        if (attempt < maxRetries) {
          await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
          continue;
        }
      }

      throw new FetchError(
        `DexScreener returned ${resp.status}`,
        resp.status,
        false,
      );
    } catch (err) {
      if (err instanceof FetchError && !err.retriable) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 8000));
      }
    }
  }

  throw lastError ?? new FetchError('All retries exhausted', undefined, false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function mapDexVersion(dexId: string): 'V2' | 'V3' | 'V4' {
  const id = dexId.toLowerCase();
  if (id.includes('v4')) return 'V4';
  if (id.includes('v3') || id.includes('cl') || id.includes('slipstream')) return 'V3';
  return 'V2';
}

export function mapDexName(dexId: string): string {
  const id = dexId.toLowerCase();
  if (id.startsWith('pancakeswap')) return 'PancakeSwap';
  if (id.startsWith('uniswap')) return 'Uniswap';
  if (id.startsWith('sushiswap')) return 'SushiSwap';
  if (id.startsWith('thena')) return 'Thena';
  if (id.startsWith('biswap')) return 'BiSwap';
  if (id === 'up' || id.startsWith('up_') || id.includes('up33') || id.includes('aerodrome') || id.includes('velodrome')) return 'UP33';
  return dexId;
}

export function inferFeeRateFromDexId(dexId: string): number | null {
  const id = dexId.toLowerCase();
  // V3/V4/CL have variable fee tiers — must read on-chain
  if (id.includes('v3') || id.includes('v4') || id.includes('cl') || id.includes('slipstream')) return null;
  if (id.startsWith('pancakeswap')) return 0.25;
  if (id.startsWith('biswap')) return 0.10;
  if (id.startsWith('thena')) return 0.30;
  return 0.30; // default V2
}

export function estimateFeeUsd(volumeH24: number, feeRatePercent: number | null): number | null {
  if (feeRatePercent === null || !volumeH24) return null;
  return volumeH24 * (feeRatePercent / 100);
}

export interface FetchResult {
  pools: PoolData[];
  errors: string[];
  partial: boolean;
}

export async function fetchTopPools(chainId: number): Promise<FetchResult> {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) return { pools: [], errors: [`Unknown chain ${chainId}`], partial: false };

  const tokens = DISCOVERY_TOKENS[chainId] || [];
  const allPairs: DexScreenerPair[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let succeeded = 0;

  // Throttle: sequential with small delay to avoid 429
  for (const token of tokens) {
    try {
      const resp = await fetchWithRetry(
        `${DEXSCREENER_API}/latest/dex/tokens/${token}`,
      );
      const data = await resp.json();
      const pairs: DexScreenerPair[] = (data.pairs || []).filter(
        (p: DexScreenerPair) => p.chainId === slug,
      );
      for (const p of pairs) {
        if (!seen.has(p.pairAddress)) {
          seen.add(p.pairAddress);
          allPairs.push(p);
        }
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Token ${token.slice(0, 10)}…: ${msg}`);
    }

    // Small throttle between requests
    if (tokens.indexOf(token) < tokens.length - 1) {
      await sleep(200);
    }
  }

  // Strategy 2: Search-based discovery to surface V3/V4 pools
  const searchQueries = SEARCH_QUERIES[chainId] || [];
  for (const query of searchQueries) {
    try {
      const resp = await fetchWithRetry(
        `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(query)}`,
      );
      const data = await resp.json();
      const pairs: DexScreenerPair[] = (data.pairs || []).filter(
        (p: DexScreenerPair) => p.chainId === slug,
      );
      for (const p of pairs) {
        if (!seen.has(p.pairAddress)) {
          seen.add(p.pairAddress);
          allPairs.push(p);
        }
      }
      succeeded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Search "${query}": ${msg}`);
    }
    await sleep(200);
  }

  if (succeeded === 0 && (tokens.length > 0 || searchQueries.length > 0)) {
    throw new FetchError(
      `All fetches failed: ${errors.join('; ')}`,
      undefined,
      true,
    );
  }

  const pools = allPairs
    .map((pair): PoolData => {
      const feeRate = inferFeeRateFromDexId(pair.dexId);
      const vol24 = pair.volume?.h24 ?? 0;
      const feeUsd = estimateFeeUsd(vol24, feeRate);
      const tvlUsd = pair.liquidity?.usd ?? null;
      const txCount = pair.txns?.h24
        ? pair.txns.h24.buys + pair.txns.h24.sells
        : null;

      return {
        id: `${pair.pairAddress}-${pair.dexId}`,
        pairAddress: pair.pairAddress,
        token0Symbol: pair.baseToken.symbol,
        token1Symbol: pair.quoteToken.symbol,
        token0Address: pair.baseToken.address,
        token1Address: pair.quoteToken.address,
        dex: mapDexName(pair.dexId),
        version: mapDexVersion(pair.dexId),
        chainId,
        priceUsd: pair.priceUsd ? parseFloat(pair.priceUsd) : null,
        feeRate,
        feeUsd,
        tvlUsd,
        feeTvlRatio: computeFeeTvlRatio(feeUsd, tvlUsd),
        volumeUsd: vol24 || null,
        txCount,
        pairSymbol: `${pair.baseToken.symbol}/${pair.quoteToken.symbol}`,
      };
    })
    .filter((p) => p.tvlUsd !== null && p.tvlUsd > 0)
    .sort((a, b) => (b.feeUsd ?? 0) - (a.feeUsd ?? 0));

  return {
    pools,
    errors,
    partial: errors.length > 0 && succeeded > 0,
  };
}
