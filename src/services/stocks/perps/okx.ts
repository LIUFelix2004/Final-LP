import type { PerpQuote, FundingPoint } from '../../../types/stocks';

interface OkxInstrument {
  instId: string;
  instCategory: string;
  ctVal: string;
  ctValCcy: string;
}

interface OkxMarkPrice {
  instId: string;
  markPx: string;
}

interface OkxTicker {
  instId: string;
  last: string;
  volCcy24h: string;
  vol24h: string;
}

interface OkxFundingRate {
  instId: string;
  fundingRate: string;
  fundingTime: string;
  nextFundingTime: string;
}

interface OkxIndexTicker {
  instId: string;
  idxPx: string;
}

let instrumentsCache: Map<string, OkxInstrument> | null = null;
let instrumentsCacheTime = 0;

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function instIdToSymbol(instId: string): string {
  return instId.replace(/-USDT-SWAP$/, '').replace(/-USDC-SWAP$/, '');
}

export function parseOkxInstruments(data: { data: OkxInstrument[] }): Map<string, OkxInstrument> {
  const map = new Map<string, OkxInstrument>();
  for (const inst of data.data) {
    if (inst.instCategory === '3' && inst.instId.endsWith('-SWAP')) {
      map.set(inst.instId, inst);
    }
  }
  return map;
}

export function buildOkxQuote(
  stockSymbol: string,
  instruments: Map<string, OkxInstrument>,
  marks: Map<string, string>,
  tickers: Map<string, OkxTicker>,
  fundingRates: Map<string, OkxFundingRate>,
  indexPrices: Map<string, string>,
): PerpQuote | null {
  const candidates: Array<{ instId: string; vol: number }> = [];
  for (const [instId] of instruments) {
    const sym = instIdToSymbol(instId);
    if (sym !== stockSymbol) continue;
    const ticker = tickers.get(instId);
    const last = safeNum(ticker?.last) ?? 0;
    const volCcy = safeNum(ticker?.volCcy24h) ?? 0;
    candidates.push({ instId, vol: volCcy * last });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.vol - a.vol);
  const best = candidates[0];

  const ticker = tickers.get(best.instId);
  const fr = fundingRates.get(best.instId);
  const last = safeNum(ticker?.last);
  const volCcy = safeNum(ticker?.volCcy24h);
  const volume24h = last !== null && volCcy !== null ? volCcy * last : null;
  const fundingTime = safeNum(fr?.fundingTime);
  const nextFundingTime = safeNum(fr?.nextFundingTime);
  const intervalHours = fundingTime !== null && nextFundingTime !== null && nextFundingTime > fundingTime
    ? (nextFundingTime - fundingTime) / 3_600_000
    : 8;

  const indexKey = `${stockSymbol}-USDT`;

  return {
    exchange: 'okx',
    symbol: stockSymbol,
    contract: best.instId,
    lastPrice: last,
    markPrice: safeNum(marks.get(best.instId)),
    indexPrice: safeNum(indexPrices.get(indexKey)),
    volume24h,
    fundingRate: safeNum(fr?.fundingRate),
    fundingIntervalHours: intervalHours,
    nextFundingTime: nextFundingTime,
  };
}

export async function fetchOkxData(fetchFn: typeof fetch): Promise<{
  instruments: Map<string, OkxInstrument>;
  marks: Map<string, string>;
  tickers: Map<string, OkxTicker>;
  fundingRates: Map<string, OkxFundingRate>;
  indexPrices: Map<string, string>;
}> {
  const now = Date.now();
  if (!instrumentsCache || now - instrumentsCacheTime > 3600_000) {
    const resp = await fetchFn('/api/cex/okx/api/v5/public/instruments?instType=SWAP');
    if (!resp.ok) throw new Error(`OKX instruments: ${resp.status}`);
    const data = await resp.json();
    instrumentsCache = parseOkxInstruments(data);
    instrumentsCacheTime = now;
  }

  const stockInstIds = [...instrumentsCache.keys()];

  const [markResp, tickerResp, indexResp] = await Promise.all([
    fetchFn('/api/cex/okx/api/v5/public/mark-price?instType=SWAP'),
    fetchFn('/api/cex/okx/api/v5/market/tickers?instType=SWAP'),
    fetchFn('/api/cex/okx/api/v5/market/index-tickers?quoteCcy=USDT'),
  ]);

  const frBatch = await Promise.allSettled(
    stockInstIds.slice(0, 30).map(instId =>
      fetchFn(`/api/cex/okx/api/v5/public/funding-rate?instId=${instId}`).then(async r => {
        if (!r.ok) return [];
        const d = await r.json();
        return (d.data ?? []) as OkxFundingRate[];
      })
    )
  );
  const frDataAll: OkxFundingRate[] = [];
  for (const r of frBatch) {
    if (r.status === 'fulfilled') frDataAll.push(...r.value);
  }

  const markData = markResp.ok ? await markResp.json() : { data: [] };
  const tickerData = tickerResp.ok ? await tickerResp.json() : { data: [] };
  const indexData = indexResp.ok ? await indexResp.json() : { data: [] };

  const marks = new Map<string, string>();
  for (const m of (markData.data ?? []) as OkxMarkPrice[]) {
    marks.set(m.instId, m.markPx);
  }

  const tickers = new Map<string, OkxTicker>();
  for (const t of (tickerData.data ?? []) as OkxTicker[]) {
    tickers.set(t.instId, t);
  }

  const fundingRates = new Map<string, OkxFundingRate>();
  for (const f of frDataAll) {
    fundingRates.set(f.instId, f);
  }

  const indexPrices = new Map<string, string>();
  for (const idx of (indexData.data ?? []) as OkxIndexTicker[]) {
    indexPrices.set(idx.instId, idx.idxPx);
  }

  return { instruments: instrumentsCache, marks, tickers, fundingRates, indexPrices };
}

export async function fetchOkxFundingHistory(symbol: string, fetchFn: typeof fetch): Promise<FundingPoint[]> {
  const instId = `${symbol}-USDT-SWAP`;
  const resp = await fetchFn(`/api/cex/okx/api/v5/public/funding-rate-history?instId=${instId}&limit=6`);
  if (!resp.ok) throw new Error(`OKX fundingHistory ${instId}: ${resp.status}`);
  const data = await resp.json();
  return ((data.data ?? []) as Array<{ fundingTime: string; fundingRate: string }>)
    .map(d => ({ time: Number(d.fundingTime), rate: safeNum(d.fundingRate) ?? 0 }))
    .sort((a, b) => a.time - b.time);
}
