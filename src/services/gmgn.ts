import type { PoolData } from '../types';
import {
  CHAIN_SLUG,
  mapPairToPoolData,
  fetchPairsByTokens,
} from './dexscreener';
import type { FetchResult } from './dexscreener';

const GMGN_PROXY = '/api/gmgn';

export const GMGN_CHAIN_SLUG: Record<number, string> = {
  56: 'bsc',
  4663: 'robinhood',
};

export interface GmgnSettings {
  minSmartBuyUsd: number;
  includeKol: boolean;
  limit: number;
}

export const DEFAULT_GMGN_SETTINGS: GmgnSettings = {
  minSmartBuyUsd: 50,
  includeKol: false,
  limit: 100,
};

const GMGN_SETTINGS_KEY = 'lp-gmgn-settings-v1';

export function loadGmgnSettings(): GmgnSettings {
  try {
    const raw = localStorage.getItem(GMGN_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_GMGN_SETTINGS };
    return { ...DEFAULT_GMGN_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_GMGN_SETTINGS };
  }
}

export function saveGmgnSettings(s: GmgnSettings): void {
  try {
    localStorage.setItem(GMGN_SETTINGS_KEY, JSON.stringify(s));
  } catch { /* quota */ }
}

export interface GmgnTokenRank {
  address: string;
  symbol: string;
  price: number;
  volume: number;
  liquidity: number;
  market_cap: number;
  swaps: number;
  buys: number;
  sells: number;
  smart_buy_24h: number;
  smart_sell_24h: number;
  holder_count: number;
  open_timestamp: number;
  is_honeypot: number;
  buy_tax: string;
  sell_tax: string;
}

interface GmgnResponse {
  code: number;
  msg?: string;
  data?: {
    rank?: GmgnTokenRank[];
  };
}

export function isGmgnConfigured(): boolean {
  try {
    return import.meta.env.VITE_GMGN_CONFIGURED === 'true';
  } catch {
    return false;
  }
}

export async function fetchSmartMoneyTokens(
  chainId: number,
  settings: GmgnSettings,
): Promise<GmgnTokenRank[]> {
  const chain = GMGN_CHAIN_SLUG[chainId];
  if (!chain) throw new Error(`GMGN does not support chain ${chainId}`);

  const url = `${GMGN_PROXY}/rank/${chain}/swaps/1h?orderby=smartmoney&direction=desc&limit=${settings.limit}`;
  const resp = await fetch(url);

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('GMGN API key missing or invalid — set GMGN_API_KEY in .env');
  }
  if (!resp.ok) {
    throw new Error(`GMGN API returned ${resp.status}`);
  }

  const json: GmgnResponse = await resp.json();
  if (json.code !== 0 || !json.data?.rank) {
    throw new Error(json.msg || 'GMGN returned unexpected response');
  }

  return json.data.rank.filter((t) => t.smart_buy_24h > 0);
}

export function extractTokenAddresses(
  ranks: GmgnTokenRank[],
  _settings: GmgnSettings,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const t of ranks) {
    const addr = t.address?.toLowerCase();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    result.push(addr);
  }

  return result;
}

export async function fetchGmgnPools(
  chainId: number,
  settings: GmgnSettings,
): Promise<FetchResult> {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) return { pools: [], errors: [`Unknown chain ${chainId}`], partial: false };

  const ranks = await fetchSmartMoneyTokens(chainId, settings);
  const tokens = extractTokenAddresses(ranks, settings);

  if (tokens.length === 0) {
    return { pools: [], errors: [], partial: false };
  }

  const smartMap = new Map<string, GmgnTokenRank>();
  for (const r of ranks) {
    smartMap.set(r.address.toLowerCase(), r);
  }

  const { pairs, errors } = await fetchPairsByTokens(tokens.slice(0, 30), chainId);

  const pools: PoolData[] = pairs
    .map((pair) => {
      const pool = mapPairToPoolData(pair, chainId);

      const baseSmrt = smartMap.get(pair.baseToken.address.toLowerCase());
      const quoteSmrt = smartMap.get(pair.quoteToken.address.toLowerCase());
      const smrt = baseSmrt ?? quoteSmrt;
      if (smrt) {
        pool.smartBuyCount = smrt.smart_buy_24h;
        pool.smartBuyUsdSum = smrt.volume;
        pool.lastSmartBuyAt = smrt.open_timestamp ? smrt.open_timestamp * 1000 : undefined;
      }
      return pool;
    })
    .filter((p) => p.tvlUsd !== null && p.tvlUsd > 0)
    .sort((a, b) => (b.smartBuyCount ?? 0) - (a.smartBuyCount ?? 0));

  return { pools, errors, partial: errors.length > 0 };
}
