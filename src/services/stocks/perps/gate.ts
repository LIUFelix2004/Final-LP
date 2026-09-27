import type { PerpQuote, FundingPoint } from '../../../types/stocks';

interface GateContract {
  name: string;
  contract_type: string;
  funding_interval: number;
}

interface GateTicker {
  contract: string;
  last: string;
  mark_price: string;
  index_price: string;
  funding_rate: string;
  volume_24h_quote: string;
}

let contractsCache: Map<string, GateContract> | null = null;
let contractsCacheTime = 0;

function safeNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function contractToSymbol(name: string): string {
  return name.replace(/_USDT$/, '').replace(/_USDC$/, '');
}

function isXStocks(name: string): boolean {
  const sym = contractToSymbol(name);
  return /X$/.test(sym) || /ON$/.test(sym) || /x$/.test(sym);
}

export function parseGateContracts(data: GateContract[]): Map<string, GateContract> {
  const map = new Map<string, GateContract>();
  for (const c of data) {
    if (c.contract_type === 'stocks' && !isXStocks(c.name)) {
      map.set(c.name, c);
    }
  }
  return map;
}

export function parseGateTickers(data: GateTicker[], contracts: Map<string, GateContract>): Map<string, GateTicker> {
  const map = new Map<string, GateTicker>();
  for (const t of data) {
    if (contracts.has(t.contract)) {
      map.set(t.contract, t);
    }
  }
  return map;
}

export function buildGateQuote(
  stockSymbol: string,
  contracts: Map<string, GateContract>,
  tickers: Map<string, GateTicker>,
): PerpQuote | null {
  const candidates: Array<{ contract: string; vol: number }> = [];
  for (const [name] of contracts) {
    const sym = contractToSymbol(name);
    if (sym !== stockSymbol) continue;
    const ticker = tickers.get(name);
    const vol = safeNum(ticker?.volume_24h_quote) ?? 0;
    candidates.push({ contract: name, vol });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.vol - a.vol);
  const best = candidates[0];

  const ticker = tickers.get(best.contract);
  const contract = contracts.get(best.contract);
  const intervalHours = contract ? contract.funding_interval / 3600 : 8;

  return {
    exchange: 'gate',
    symbol: stockSymbol,
    contract: best.contract,
    lastPrice: safeNum(ticker?.last),
    markPrice: safeNum(ticker?.mark_price),
    indexPrice: safeNum(ticker?.index_price),
    volume24h: safeNum(ticker?.volume_24h_quote),
    fundingRate: safeNum(ticker?.funding_rate),
    fundingIntervalHours: intervalHours,
    nextFundingTime: null,
  };
}

export async function fetchGateData(fetchFn: typeof fetch): Promise<{
  contracts: Map<string, GateContract>;
  tickers: Map<string, GateTicker>;
}> {
  const now = Date.now();
  if (!contractsCache || now - contractsCacheTime > 3600_000) {
    const resp = await fetchFn('/api/cex/gate/api/v4/futures/usdt/contracts');
    if (!resp.ok) throw new Error(`Gate contracts: ${resp.status}`);
    const data: GateContract[] = await resp.json();
    contractsCache = parseGateContracts(data);
    contractsCacheTime = now;
  }

  const tickerResp = await fetchFn('/api/cex/gate/api/v4/futures/usdt/tickers');
  if (!tickerResp.ok) throw new Error(`Gate tickers: ${tickerResp.status}`);
  const tickerData: GateTicker[] = await tickerResp.json();

  return {
    contracts: contractsCache,
    tickers: parseGateTickers(tickerData, contractsCache),
  };
}

export function parseGateFundingHistory(data: Array<{ r: string; t: number }>): FundingPoint[] {
  return data
    .map(d => ({ time: d.t * 1000, rate: safeNum(d.r) ?? 0 }))
    .sort((a, b) => a.time - b.time);
}

export async function fetchGateFundingHistory(symbol: string, fetchFn: typeof fetch): Promise<FundingPoint[]> {
  const contract = `${symbol}_USDT`;
  const resp = await fetchFn(`/api/cex/gate/api/v4/futures/usdt/funding_rate?contract=${contract}&limit=6`);
  if (!resp.ok) throw new Error(`Gate fundingRate ${contract}: ${resp.status}`);
  const data = await resp.json();
  return parseGateFundingHistory(data);
}
