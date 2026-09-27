import type { PerpQuote, FundingPoint } from '../../../types/stocks';

interface BybitInstrument {
  symbol: string;
  status: string;
  marketRegion?: string;
  symbolType?: string;
  baseAsset?: string;
  fundingInterval?: string;
}

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  markPrice: string;
  indexPrice: string;
  fundingRate: string;
  nextFundingTime: string;
  fundingIntervalHour?: string;
  turnover24h: string;
}

let instrumentsCache: Map<string, BybitInstrument> | null = null;
let instrumentsCacheTime = 0;

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseBybitInstruments(data: { result: { list: BybitInstrument[] } }): Map<string, BybitInstrument> {
  const map = new Map<string, BybitInstrument>();
  for (const inst of data.result.list) {
    if (inst.symbolType === 'xstocks') continue;
    if (inst.status !== 'Trading') continue;
    map.set(inst.symbol, inst);
  }
  return map;
}

export function buildBybitQuote(
  stockSymbol: string,
  instruments: Map<string, BybitInstrument>,
  tickers: Map<string, BybitTicker>,
): PerpQuote | null {
  const candidates: Array<{ sym: string; vol: number }> = [];
  for (const [sym, inst] of instruments) {
    const base = inst.baseAsset ?? sym.replace(/USDT$/, '').replace(/USDC$/, '');
    if (base !== stockSymbol) continue;
    const ticker = tickers.get(sym);
    const vol = safeNum(ticker?.turnover24h) ?? 0;
    candidates.push({ sym, vol });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.vol - a.vol);
  const best = candidates[0];

  const ticker = tickers.get(best.sym);
  const intervalHour = safeNum(ticker?.fundingIntervalHour) ?? 8;

  return {
    exchange: 'bybit',
    symbol: stockSymbol,
    contract: best.sym,
    lastPrice: safeNum(ticker?.lastPrice),
    markPrice: safeNum(ticker?.markPrice),
    indexPrice: safeNum(ticker?.indexPrice),
    volume24h: safeNum(ticker?.turnover24h),
    fundingRate: safeNum(ticker?.fundingRate),
    fundingIntervalHours: intervalHour,
    nextFundingTime: safeNum(ticker?.nextFundingTime),
  };
}

export async function fetchBybitData(fetchFn: typeof fetch): Promise<{
  instruments: Map<string, BybitInstrument>;
  tickers: Map<string, BybitTicker>;
}> {
  const now = Date.now();
  if (!instrumentsCache || now - instrumentsCacheTime > 3600_000) {
    const resp = await fetchFn('/api/cex/bybit/v5/market/instruments-info?category=linear&limit=1000');
    if (!resp.ok) throw new Error(`Bybit instruments: ${resp.status}`);
    const data = await resp.json();
    instrumentsCache = parseBybitInstruments(data);
    instrumentsCacheTime = now;
  }

  const tickerResp = await fetchFn('/api/cex/bybit/v5/market/tickers?category=linear');
  if (!tickerResp.ok) throw new Error(`Bybit tickers: ${tickerResp.status}`);
  const tickerData = await tickerResp.json();

  const tickers = new Map<string, BybitTicker>();
  for (const t of (tickerData.result?.list ?? []) as BybitTicker[]) {
    if (instrumentsCache.has(t.symbol)) {
      tickers.set(t.symbol, t);
    }
  }

  return { instruments: instrumentsCache, tickers };
}

export function parseBybitFundingHistory(data: { result: { list: Array<{ fundingRate: string; fundingRateTimestamp: string }> } }): FundingPoint[] {
  return (data.result?.list ?? [])
    .map(d => ({ time: Number(d.fundingRateTimestamp), rate: safeNum(d.fundingRate) ?? 0 }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchBybitFundingHistory(symbol: string, fetchFn: typeof fetch): Promise<FundingPoint[]> {
  const contract = `${symbol}USDT`;
  const resp = await fetchFn(`/api/cex/bybit/v5/market/funding/history?category=linear&symbol=${contract}&limit=6`);
  if (!resp.ok) throw new Error(`Bybit fundingHistory ${contract}: ${resp.status}`);
  const data = await resp.json();
  return parseBybitFundingHistory(data);
}
