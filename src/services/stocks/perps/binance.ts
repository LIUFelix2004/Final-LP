import type { PerpQuote, FundingPoint } from '../../../types/stocks';

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  contractType: string;
  underlyingType: string;
  baseAsset: string;
  quoteAsset: string;
}

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
}

interface BinanceFundingInfo {
  symbol: string;
  fundingIntervalHours: number;
}

let equitySymbolsCache: Map<string, BinanceSymbolInfo> | null = null;
let equitySymbolsCacheTime = 0;
let fundingInfoCache: Map<string, number> | null = null;

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseBinanceExchangeInfo(data: { symbols: BinanceSymbolInfo[] }): Map<string, BinanceSymbolInfo> {
  const map = new Map<string, BinanceSymbolInfo>();
  for (const s of data.symbols) {
    if (s.underlyingType === 'EQUITY' && s.status === 'TRADING') {
      map.set(s.symbol, s);
    }
  }
  return map;
}

export function parseBinancePremiumIndex(data: BinancePremiumIndex[], equities: Map<string, BinanceSymbolInfo>): Map<string, BinancePremiumIndex> {
  const map = new Map<string, BinancePremiumIndex>();
  for (const item of data) {
    if (equities.has(item.symbol)) {
      map.set(item.symbol, item);
    }
  }
  return map;
}

export function parseBinanceTickers(data: BinanceTicker[], equities: Map<string, BinanceSymbolInfo>): Map<string, BinanceTicker> {
  const map = new Map<string, BinanceTicker>();
  for (const item of data) {
    if (equities.has(item.symbol)) {
      map.set(item.symbol, item);
    }
  }
  return map;
}

export function buildBinanceQuote(
  stockSymbol: string,
  equities: Map<string, BinanceSymbolInfo>,
  premiums: Map<string, BinancePremiumIndex>,
  tickers: Map<string, BinanceTicker>,
  fundingIntervals: Map<string, number>,
): PerpQuote | null {
  const candidates: Array<{ sym: string; vol: number }> = [];
  for (const [sym, info] of equities) {
    if (info.baseAsset !== stockSymbol) continue;
    const ticker = tickers.get(sym);
    const vol = safeNum(ticker?.quoteVolume) ?? 0;
    candidates.push({ sym, vol });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.vol - a.vol);
  const best = candidates[0];

  const prem = premiums.get(best.sym);
  const ticker = tickers.get(best.sym);
  const interval = fundingIntervals.get(best.sym) ?? 8;

  return {
    exchange: 'binance',
    symbol: stockSymbol,
    contract: best.sym,
    lastPrice: safeNum(ticker?.lastPrice),
    markPrice: safeNum(prem?.markPrice),
    indexPrice: safeNum(prem?.indexPrice),
    volume24h: safeNum(ticker?.quoteVolume),
    fundingRate: safeNum(prem?.lastFundingRate),
    fundingIntervalHours: interval,
    nextFundingTime: prem?.nextFundingTime ?? null,
  };
}

export function parseBinanceFundingHistory(data: Array<{ fundingTime: number; fundingRate: string }>): FundingPoint[] {
  return data
    .map(d => ({ time: d.fundingTime, rate: safeNum(d.fundingRate) ?? 0 }))
    .sort((a, b) => a.time - b.time);
}

async function throwProxyError(resp: Response, label: string): Promise<never> {
  if (resp.status === 502) {
    try {
      const body = await resp.json();
      if (body && typeof body === 'object' && body.status) {
        throw new Error(JSON.stringify({ exchange: 'binance', status: body.status }));
      }
    } catch (e) { if (e instanceof Error && e.message.startsWith('{')) throw e; }
  }
  throw new Error(`Binance ${label}: ${resp.status}`);
}

export async function fetchBinanceData(fetchFn: typeof fetch): Promise<{
  equities: Map<string, BinanceSymbolInfo>;
  premiums: Map<string, BinancePremiumIndex>;
  tickers: Map<string, BinanceTicker>;
  fundingIntervals: Map<string, number>;
}> {
  const now = Date.now();
  if (!equitySymbolsCache || now - equitySymbolsCacheTime > 3600_000) {
    const resp = await fetchFn('/api/cex/binance/fapi/v1/exchangeInfo');
    if (!resp.ok) await throwProxyError(resp, 'exchangeInfo');
    const data = await resp.json();
    equitySymbolsCache = parseBinanceExchangeInfo(data);
    equitySymbolsCacheTime = now;
  }

  if (!fundingInfoCache) {
    try {
      const resp = await fetchFn('/api/cex/binance/fapi/v1/fundingInfo');
      if (resp.ok) {
        const data: BinanceFundingInfo[] = await resp.json();
        fundingInfoCache = new Map(data.map(d => [d.symbol, d.fundingIntervalHours]));
      }
    } catch { /* use default 8 */ }
    if (!fundingInfoCache) fundingInfoCache = new Map();
  }

  const [premResp, tickerResp] = await Promise.all([
    fetchFn('/api/cex/binance/fapi/v1/premiumIndex'),
    fetchFn('/api/cex/binance/fapi/v1/ticker/24hr'),
  ]);

  if (!premResp.ok) await throwProxyError(premResp, 'premiumIndex');
  if (!tickerResp.ok) await throwProxyError(tickerResp, 'ticker');

  const premData: BinancePremiumIndex[] = await premResp.json();
  const tickerData: BinanceTicker[] = await tickerResp.json();

  return {
    equities: equitySymbolsCache,
    premiums: parseBinancePremiumIndex(premData, equitySymbolsCache),
    tickers: parseBinanceTickers(tickerData, equitySymbolsCache),
    fundingIntervals: fundingInfoCache,
  };
}

export async function fetchBinanceFundingHistory(symbol: string, fetchFn: typeof fetch): Promise<FundingPoint[]> {
  const contract = `${symbol}USDT`;
  const resp = await fetchFn(`/api/cex/binance/fapi/v1/fundingRate?symbol=${contract}&limit=6`);
  if (!resp.ok) throw new Error(`Binance fundingRate ${contract}: ${resp.status}`);
  const data = await resp.json();
  return parseBinanceFundingHistory(data);
}
