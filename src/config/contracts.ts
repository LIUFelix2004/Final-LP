export interface DexConfig {
  name: string;
  versions: DexVersionConfig[];
}

export interface DexVersionConfig {
  version: 'V2' | 'V3' | 'V4';
  factoryAddress: string;
}

export const BSC_DEXES: DexConfig[] = [
  {
    name: 'PancakeSwap',
    versions: [
      { version: 'V2', factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73' },
      { version: 'V3', factoryAddress: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' },
    ],
  },
  {
    name: 'Uniswap',
    versions: [
      { version: 'V2', factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6' },
      { version: 'V3', factoryAddress: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7' },
      { version: 'V4', factoryAddress: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF' },
    ],
  },
];

export const ROBINHOOD_DEXES: DexConfig[] = [
  {
    name: 'UP33',
    versions: [
      { version: 'V2', factoryAddress: '0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28' },
      { version: 'V3', factoryAddress: '0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3' },
    ],
  },
  {
    name: 'Uniswap',
    versions: [
      { version: 'V2', factoryAddress: '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f' },
      { version: 'V3', factoryAddress: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA' },
      { version: 'V4', factoryAddress: '0x8366a39CC670B4001A1121B8F6A443A643e40951' },
    ],
  },
];

export const DEX_CONFIGS: Record<number, DexConfig[]> = {
  56: BSC_DEXES,
  4663: ROBINHOOD_DEXES,
};
