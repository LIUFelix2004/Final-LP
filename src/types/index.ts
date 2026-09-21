export type TimeWindow = 'm5' | 'm15' | 'h1' | 'h6' | 'h24';
export type DiscoveryMode = 'major' | 'gmgn';

export interface WindowData {
  volume: number | null;
  txCount: number | null;
}

export interface PoolData {
  id: string;
  pairAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: string;
  token1Address: string;
  dex: string;
  version: 'V2' | 'V3' | 'V4';
  chainId: number;
  priceUsd: number | null;
  feeRate: number | null;
  feeUsd: number | null;
  tvlUsd: number | null;
  feeTvlRatio: number | null;
  volumeUsd: number | null;
  txCount: number | null;
  pairSymbol: string;
  windows: Record<'m5' | 'h1' | 'h6' | 'h24', WindowData>;
  smartBuyCount?: number;
  smartBuyUsdSum?: number;
  lastSmartBuyAt?: number;
  v4DynamicFee?: boolean;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: string;
}

export type SortField = 'feeUsd' | 'feeRate' | 'tvlUsd' | 'feeTvlRatio' | 'volumeUsd' | 'txCount' | 'priceUsd' | 'smartBuyCount' | 'smartBuyUsdSum';
export type SortDirection = 'asc' | 'desc';

export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  m5: '5m',
  m15: '15m≈',
  h1: '1h',
  h6: '6h',
  h24: '24h',
};
