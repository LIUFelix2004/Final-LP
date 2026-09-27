import type { PerpQuote, FundingPoint } from '../../../types/stocks';
import { fetchBinanceData, buildBinanceQuote, fetchBinanceFundingHistory } from './binance';
import { fetchOkxData, buildOkxQuote, fetchOkxFundingHistory } from './okx';
import { fetchGateData, buildGateQuote, fetchGateFundingHistory } from './gate';
import { fetchBybitData, buildBybitQuote, fetchBybitFundingHistory } from './bybit';
import { fetchHlData, buildHlQuote, fetchHlFundingHistory } from './hyperliquid';

export interface AllPerpData {
  binance: Awaited<ReturnType<typeof fetchBinanceData>> | null;
  okx: Awaited<ReturnType<typeof fetchOkxData>> | null;
  gate: Awaited<ReturnType<typeof fetchGateData>> | null;
  bybit: Awaited<ReturnType<typeof fetchBybitData>> | null;
  hyperliquid: Awaited<ReturnType<typeof fetchHlData>> | null;
  errors: string[];
}

export async function fetchAllPerpData(fetchFn: typeof fetch = fetch): Promise<AllPerpData> {
  const errors: string[] = [];

  const results = await Promise.allSettled([
    fetchBinanceData(fetchFn),
    fetchOkxData(fetchFn),
    fetchGateData(fetchFn),
    fetchBybitData(fetchFn),
    fetchHlData(fetchFn),
  ]);

  const exchanges = ['Binance', 'OKX', 'Gate', 'Bybit', 'Hyperliquid'];
  const resolved: (unknown | null)[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${exchanges[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
    return null;
  });

  return {
    binance: resolved[0] as AllPerpData['binance'],
    okx: resolved[1] as AllPerpData['okx'],
    gate: resolved[2] as AllPerpData['gate'],
    bybit: resolved[3] as AllPerpData['bybit'],
    hyperliquid: resolved[4] as AllPerpData['hyperliquid'],
    errors,
  };
}

export function getQuotesForStock(symbol: string, data: AllPerpData): PerpQuote[] {
  const quotes: PerpQuote[] = [];

  if (data.binance) {
    const q = buildBinanceQuote(symbol, data.binance.equities, data.binance.premiums, data.binance.tickers, data.binance.fundingIntervals);
    if (q) quotes.push(q);
  }
  if (data.okx) {
    const q = buildOkxQuote(symbol, data.okx.instruments, data.okx.marks, data.okx.tickers, data.okx.fundingRates, data.okx.indexPrices);
    if (q) quotes.push(q);
  }
  if (data.gate) {
    const q = buildGateQuote(symbol, data.gate.contracts, data.gate.tickers);
    if (q) quotes.push(q);
  }
  if (data.bybit) {
    const q = buildBybitQuote(symbol, data.bybit.instruments, data.bybit.tickers);
    if (q) quotes.push(q);
  }
  if (data.hyperliquid) {
    const q = buildHlQuote(symbol, data.hyperliquid);
    if (q) quotes.push(q);
  }

  return quotes;
}

export async function fetchFundingHistoryForStock(
  symbol: string,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, { points: FundingPoint[]; intervalHours: number }>> {
  const results = await Promise.allSettled([
    fetchBinanceFundingHistory(symbol, fetchFn).then(pts => ({ exchange: 'binance', points: pts, intervalHours: 8 })),
    fetchOkxFundingHistory(symbol, fetchFn).then(pts => ({ exchange: 'okx', points: pts, intervalHours: 8 })),
    fetchGateFundingHistory(symbol, fetchFn).then(pts => ({ exchange: 'gate', points: pts, intervalHours: 8 })),
    fetchBybitFundingHistory(symbol, fetchFn).then(pts => ({ exchange: 'bybit', points: pts, intervalHours: 8 })),
    fetchHlFundingHistory(symbol, fetchFn).then(pts => ({ exchange: 'hyperliquid', points: pts, intervalHours: 1 })),
  ]);

  const out: Record<string, { points: FundingPoint[]; intervalHours: number }> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      out[r.value.exchange] = { points: r.value.points, intervalHours: r.value.intervalHours };
    }
  }
  return out;
}
