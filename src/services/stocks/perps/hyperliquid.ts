import type { PerpQuote, FundingPoint } from '../../../types/stocks';

interface HlAssetMeta {
  name: string;
  szDecimals: number;
}

interface HlAssetCtx {
  funding: string;
  markPx: string;
  oraclePx: string;
  midPx: string;
  dayNtlVlm: string;
}

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function stripXyzPrefix(name: string): string | null {
  if (!name.startsWith('xyz:')) return null;
  return name.slice(4);
}

export function parseHlMetaAndAssetCtxs(data: [{ universe: HlAssetMeta[] }, HlAssetCtx[]]): Map<string, { meta: HlAssetMeta; ctx: HlAssetCtx }> {
  const map = new Map<string, { meta: HlAssetMeta; ctx: HlAssetCtx }>();
  const [metaPart, ctxs] = data;
  const universe = metaPart.universe;
  for (let i = 0; i < universe.length && i < ctxs.length; i++) {
    const sym = stripXyzPrefix(universe[i].name);
    if (sym) {
      map.set(sym, { meta: universe[i], ctx: ctxs[i] });
    }
  }
  return map;
}

export function buildHlQuote(
  stockSymbol: string,
  assets: Map<string, { meta: HlAssetMeta; ctx: HlAssetCtx }>,
): PerpQuote | null {
  const asset = assets.get(stockSymbol);
  if (!asset) return null;

  const ctx = asset.ctx;
  return {
    exchange: 'hyperliquid',
    symbol: stockSymbol,
    contract: `xyz:${stockSymbol}`,
    lastPrice: safeNum(ctx.midPx),
    markPrice: safeNum(ctx.markPx),
    indexPrice: safeNum(ctx.oraclePx),
    volume24h: safeNum(ctx.dayNtlVlm),
    fundingRate: safeNum(ctx.funding),
    fundingIntervalHours: 1,
    nextFundingTime: null,
  };
}

export async function fetchHlData(fetchFn: typeof fetch): Promise<Map<string, { meta: HlAssetMeta; ctx: HlAssetCtx }>> {
  const resp = await fetchFn('/api/cex/hl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs', dex: 'xyz' }),
  });
  if (!resp.ok) throw new Error(`Hyperliquid metaAndAssetCtxs: ${resp.status}`);
  const data = await resp.json();
  return parseHlMetaAndAssetCtxs(data);
}

export function parseHlFundingHistory(data: Array<{ coin: string; fundingRate: string; time: number }>): FundingPoint[] {
  return data
    .map(d => ({ time: d.time, rate: safeNum(d.fundingRate) ?? 0 }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchHlFundingHistory(symbol: string, fetchFn: typeof fetch): Promise<FundingPoint[]> {
  const now = Date.now();
  const startTime = now - 48 * 3600 * 1000;
  const resp = await fetchFn('/api/cex/hl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'fundingHistory', coin: `xyz:${symbol}`, startTime }),
  });
  if (!resp.ok) throw new Error(`Hyperliquid fundingHistory xyz:${symbol}: ${resp.status}`);
  const data = await resp.json();
  return parseHlFundingHistory(data);
}
