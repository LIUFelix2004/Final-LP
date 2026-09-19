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
}

export interface ChainConfig {
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: string;
}

export type SortField = 'feeUsd' | 'feeRate' | 'tvlUsd' | 'feeTvlRatio' | 'volumeUsd' | 'txCount' | 'priceUsd';
export type SortDirection = 'asc' | 'desc';
