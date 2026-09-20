import type { PoolData } from '../types';
import {
  CHAIN_SLUG,
  mapPairToPoolData,
  fetchPairsByTokens,
} from './dexscreener';
import type { FetchResult } from './dexscreener';

const GMGN_PRIMARY = '/api/gmgn';
const GMGN_FALLBACK = '/api/gmgnq';

export const GMGN_CHAIN_SLUG: Record<number, string> = {
  56: 'bsc',
  4663: 'robinhood',
};

const MAJOR_BASES = new Set([
  'wbnb', 'weth', 'usdt', 'usdc', 'usd1', 'usdg', 'virtual', 'up', 'eth', 'btcb',
  'busd', 'dai',
]);

export interface GmgnSettings {
  minSmartBuyCount: number;
  minSmartBuyUsd: number;
  maxAgeHours: number;
  hideMajorBases: boolean;
  includeKol: boolean;
  limit: number;
  dexFanout: number;
}

export const DEFAULT_GMGN_SETTINGS: GmgnSettings = {
  minSmartBuyCount: 3,
  minSmartBuyUsd: 50,
  maxAgeHours: 0,
  hideMajorBases: true,
  includeKol: false,
  limit: 100,
  dexFanout: 40,
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
  smart_degen_count?: number;
  smartBuyVolumeUsd?: number;
  last_smart_buy_timestamp?: number;
}

interface GmgnResponse {
  code: number;
  msg?: string;
  data?: {
    rank?: GmgnTokenRank[];
    data?: {
      rank?: GmgnTokenRank[];
    };
  };
}

export function isGmgnConfigured(): boolean {
  try {
    return import.meta.env.VITE_GMGN_CONFIGURED === 'true';
  } catch {
    return false;
  }
}

function isCfChallenge(text: string): boolean {
  return text.includes('cf-browser-verification') ||
    text.includes('cloudflare') ||
    text.includes('challenge-platform') ||
    text.includes('Just a moment');
}

function unwrapRanks(json: GmgnResponse): GmgnTokenRank[] | null {
  if (json.data?.rank && Array.isArray(json.data.rank)) return json.data.rank;
  if (json.data?.data?.rank && Array.isArray(json.data.data.rank)) return json.data.data.rank;
  return null;
}

async function tryFetchRanks(
  url: string,
  label: string,
): Promise<{ ranks: GmgnTokenRank[] | null; error: string | null; is429?: boolean }> {
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (e) {
    return { ranks: null, error: `${label}: network error — ${String(e)}` };
  }

  if (resp.status === 401 || resp.status === 403) {
    const text = await resp.text().catch(() => '');
    if (isCfChallenge(text)) {
      return { ranks: null, error: `${label}: GMGN 被 Cloudflare 拦截 (403 challenge)` };
    }
    return { ranks: null, error: `${label}: GMGN API key 无效或过期 (${resp.status})` };
  }

  if (resp.status === 429) {
    return { ranks: null, error: `${label}: GMGN 限流 (429) — 稍后再试`, is429: true };
  }

  if (!resp.ok) {
    return { ranks: null, error: `${label}: GMGN API 返回 ${resp.status}` };
  }

  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    const text = await resp.text().catch(() => '');
    if (isCfChallenge(text)) {
      return { ranks: null, error: `${label}: GMGN 被 Cloudflare 拦截 (HTML challenge)` };
    }
    return { ranks: null, error: `${label}: GMGN 返回非 JSON 响应` };
  }

  let json: GmgnResponse;
  try {
    json = await resp.json();
  } catch {
    return { ranks: null, error: `${label}: 无法解析 GMGN JSON 响应` };
  }

  if (json.code !== 0) {
    return { ranks: null, error: `${label}: GMGN 错误 code=${json.code} — ${json.msg || '未知'}` };
  }

  const ranks = unwrapRanks(json);
  if (!ranks) {
    return { ranks: null, error: `${label}: GMGN 响应结构异常 (no rank array)` };
  }

  return { ranks, error: null };
}

interface SmartMoneyResult {
  ranks: GmgnTokenRank[];
  warnings: string[];
}

export async function fetchSmartMoneyTokens(
  chainId: number,
  settings: GmgnSettings,
): Promise<SmartMoneyResult> {
  const chain = GMGN_CHAIN_SLUG[chainId];
  if (!chain) throw new Error(`GMGN does not support chain ${chainId}`);

  const warnings: string[] = [];

  const primaryUrl = `${GMGN_PRIMARY}/v1/market/rank?chain=${chain}&interval=1h&order_by=smart_degen_count&direction=desc&limit=${settings.limit}`;
  const primary = await tryFetchRanks(primaryUrl, 'OpenAPI');

  if (primary.ranks) {
    const filtered = primary.ranks.filter((t) => (t.smart_degen_count ?? t.smart_buy_24h ?? 0) > 0);
    return { ranks: filtered, warnings };
  }

  const fallbackUrl = `${GMGN_FALLBACK}/rank/${chain}/swaps/1h?orderby=smartmoney&direction=desc&limit=${settings.limit}`;
  const fallback = await tryFetchRanks(fallbackUrl, 'Quotation');

  if (fallback.ranks) {
    if (primary.is429) {
      warnings.push('OpenAPI 限流，已用 Quotation 备用');
    }
    const filtered = fallback.ranks.filter((t) => (t.smart_degen_count ?? t.smart_buy_24h ?? 0) > 0);
    return { ranks: filtered, warnings };
  }

  throw new Error(
    `GMGN 请求失败:\n• ${primary.error}\n• ${fallback.error}`,
  );
}

export function extractTokenAddresses(
  ranks: GmgnTokenRank[],
  settings: GmgnSettings,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const now = Date.now() / 1000;

  for (const t of ranks) {
    const addr = t.address?.toLowerCase();
    if (!addr || seen.has(addr)) continue;

    const buyCount = t.smart_degen_count ?? t.smart_buy_24h ?? 0;
    if (settings.minSmartBuyCount > 0 && buyCount < settings.minSmartBuyCount) continue;

    if (settings.minSmartBuyUsd > 0 && t.smartBuyVolumeUsd !== undefined) {
      if (t.smartBuyVolumeUsd < settings.minSmartBuyUsd) continue;
    }

    if (settings.maxAgeHours > 0 && t.open_timestamp > 0) {
      const ageHours = (now - t.open_timestamp) / 3600;
      if (ageHours > settings.maxAgeHours) continue;
    }

    seen.add(addr);
    result.push(addr);
  }

  return result;
}

function isMajorSymbol(sym: string): boolean {
  return MAJOR_BASES.has(sym.toLowerCase());
}

export async function fetchGmgnPools(
  chainId: number,
  settings: GmgnSettings,
): Promise<FetchResult> {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) return { pools: [], errors: [`Unknown chain ${chainId}`], partial: false };

  const { ranks, warnings: gmgnWarnings } = await fetchSmartMoneyTokens(chainId, settings);
  const tokens = extractTokenAddresses(ranks, settings);

  if (tokens.length === 0) {
    return { pools: [], errors: gmgnWarnings, partial: false };
  }

  const smartMap = new Map<string, GmgnTokenRank>();
  for (const r of ranks) {
    smartMap.set(r.address.toLowerCase(), r);
  }

  const fanout = Math.min(tokens.length, settings.dexFanout);
  const { pairs, errors: dexErrors } = await fetchPairsByTokens(tokens.slice(0, fanout), chainId);

  const allWarnings = [...gmgnWarnings];
  if (dexErrors.length > 0) {
    allWarnings.push(`${dexErrors.length}/${fanout} 个代币池拉取失败`);
  }

  let pools: PoolData[] = pairs
    .map((pair) => {
      const pool = mapPairToPoolData(pair, chainId);

      const baseSmrt = smartMap.get(pair.baseToken.address.toLowerCase());
      const quoteSmrt = smartMap.get(pair.quoteToken.address.toLowerCase());
      const smrt = baseSmrt ?? quoteSmrt;
      if (smrt) {
        pool.smartBuyCount = smrt.smart_degen_count ?? smrt.smart_buy_24h;
        pool.smartBuyUsdSum = smrt.smartBuyVolumeUsd;
        const smartTs = smrt.last_smart_buy_timestamp ?? (smrt.open_timestamp > 0 ? smrt.open_timestamp : undefined);
        pool.lastSmartBuyAt = smartTs ? smartTs * 1000 : undefined;
      }
      return pool;
    })
    .filter((p) => p.tvlUsd !== null && p.tvlUsd > 0);

  if (settings.hideMajorBases) {
    pools = pools.filter((p) => !isMajorSymbol(p.token0Symbol) || !isMajorSymbol(p.token1Symbol));
  }

  pools.sort((a, b) => (b.smartBuyCount ?? 0) - (a.smartBuyCount ?? 0));

  return { pools, errors: allWarnings, partial: allWarnings.length > 0 };
}
