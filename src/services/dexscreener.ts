import type { PoolData } from '../types';
import { computeFeeTvlRatio } from '../utils/format';

const DEXSCREENER_API = 'https://api.dexscreener.com';

interface DexScreenerPair {
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

const CHAIN_SLUG: Record<number, string> = {
  56: 'bsc',
  4663: 'robinhood',
};

// Known tokens per chain for discovery
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

function mapDexVersion(dexId: string): 'V2' | 'V3' | 'V4' {
  const id = dexId.toLowerCase();
  if (id.includes('v4')) return 'V4';
  if (id.includes('v3') || id.includes('cl') || id.includes('slipstream')) return 'V3';
  return 'V2';
}

function mapDexName(dexId: string): string {
  const id = dexId.toLowerCase();
  if (id.startsWith('pancakeswap')) return 'PancakeSwap';
  if (id.startsWith('uniswap')) return 'Uniswap';
  if (id.startsWith('sushiswap')) return 'SushiSwap';
  if (id.startsWith('thena')) return 'Thena';
  if (id.startsWith('biswap')) return 'BiSwap';
  if (id.includes('up33') || id.includes('aerodrome') || id.includes('velodrome')) return 'UP33';
  return dexId;
}

function inferFeeRate(dexId: string): number | null {
  const id = dexId.toLowerCase();
  if (id.includes('v3') || id.includes('cl') || id.includes('slipstream')) return null; // variable
  if (id.startsWith('pancakeswap')) return 0.25;
  if (id.startsWith('uniswap') && !id.includes('v3')) return 0.30;
  if (id.startsWith('biswap')) return 0.10;
  if (id.startsWith('thena')) return 0.30;
  return 0.30; // default V2
}

function estimateFee(volume: number, feeRate: number | null): number | null {
  if (feeRate === null || !volume) return null;
  return volume * (feeRate / 100);
}

export async function fetchTopPools(chainId: number): Promise<PoolData[]> {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) return [];

  const tokens = DISCOVERY_TOKENS[chainId] || [];
  const allPairs: DexScreenerPair[] = [];
  const seen = new Set<string>();

  // Fetch pairs for each discovery token
  const fetches = tokens.map(async (token) => {
    try {
      const resp = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${token}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data.pairs || []).filter(
        (p: DexScreenerPair) => p.chainId === slug
      );
    } catch {
      return [];
    }
  });

  const results = await Promise.all(fetches);
  for (const pairs of results) {
    for (const p of pairs) {
      if (!seen.has(p.pairAddress)) {
        seen.add(p.pairAddress);
        allPairs.push(p);
      }
    }
  }

  return allPairs
    .map((pair): PoolData => {
      const feeRate = inferFeeRate(pair.dexId);
      const vol24 = pair.volume?.h24 ?? 0;
      const feeUsd = estimateFee(vol24, feeRate);
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
}
