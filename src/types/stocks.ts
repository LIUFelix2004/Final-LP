export interface StockToken {
  address: string;
  symbol: string;
  name: string;
  official: boolean;
}

export interface StockPool {
  pairAddress: string;
  dexId: string;
  dex: string;
  labels: string[];
  version: 'V2' | 'V3' | 'V4';
  tokenAddress: string;
  tokenSymbol: string;
  isBaseUsdg: boolean;
  priceNative: number | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  feeRate: number | null;
  feeRateInferred: boolean;
  feeRateUnreadable?: boolean;
  volume: {
    m5: number | null;
    h1: number | null;
    h6: number | null;
    h24: number | null;
  };
}

export interface StockFeeRow {
  symbol: string;
  name: string;
  address: string;
  pools: StockPool[];
  mainPool: StockPool | null;
  onchainPrice: number | null;
  fee: {
    m5: number | null;
    h1: number | null;
    h6: number | null;
    h24: number | null;
  };
  feeUnknownCount: number;
  feeUnknownVolume24h: number;
  sampled?: {
    m30: number | null;
    h48: number | null;
    h72: number | null;
    d7: number | null;
  };
}

export type StockSortWindow = 'm5' | 'm30' | 'h1' | 'h24' | 'h48' | 'h72' | 'd7';

export interface PerpQuote {
  exchange: string;
  symbol: string;
  contract: string;
  lastPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  volume24h: number | null;
  fundingRate: number | null;
  fundingIntervalHours: number;
  nextFundingTime: number | null;
}

export interface FundingPoint {
  time: number;
  rate: number;
}

export interface FairPriceResult {
  fair: number | null;
  premium: number | null;
  onchainPrice: number | null;
  participatingExchanges: string[];
  excludedExchanges: Array<{ exchange: string; reason: string }>;
}

export interface FundingBucket {
  label: string;
  startTime: number;
  rates: Record<string, number | null>;
}

export interface StockSignal {
  text: string;
  color: 'green' | 'red' | 'blue' | 'orange' | 'gray';
}

export interface MarketSession {
  state: 'pre' | 'regular' | 'post' | 'closed';
  label: '盘前' | '盘中' | '盘后' | '美股休市';
  etTime: string;
  reason?: 'weekend' | 'holiday' | 'overnight' | 'early_close';
  nextOpen?: Date;
}
