import type { ChainConfig } from '../types';

export const CHAINS: Record<number, ChainConfig> = {
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    shortName: 'BSC',
    rpcUrl: import.meta.env.VITE_BSC_RPC || 'https://bsc-dataseed1.binance.org',
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: 'BNB',
  },
  4663: {
    chainId: 4663,
    name: 'Robinhood Chain',
    shortName: 'Robinhood',
    rpcUrl: import.meta.env.VITE_ROBINHOOD_RPC || 'https://rpc.robinhoodchain.com',
    explorerUrl: 'https://explorer.robinhoodchain.com',
    nativeCurrency: 'ETH',
  },
};

export const DEFAULT_CHAIN_ID = 56;
