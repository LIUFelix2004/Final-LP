import type { StockToken } from '../types/stocks';

export const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const USDG_DECIMALS = 6;

export const OFFICIAL_BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00';
export const BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50';
export const BEACON_UPGRADED_TOPIC = '0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e';

export const UP33_CL_FACTORY = '0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3';

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const V4_POOL_MANAGER_ROBINHOOD = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
export const V4_DYNAMIC_FEE_FLAG = 0x800000;
export const POOLS_MAPPING_SLOT = 6n;

export const V3_QUOTER_V2 = '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7';
export const V4_QUOTER = '0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94';
export const V4_STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';

export const HOT_MIN_VOLUME_24H = 10_000;
export const MIN_POOL_LIQUIDITY = 500;
export const MIN_POOL_VOLUME_24H = 1_000;
export const MAX_POOLS_PER_STOCK = 10;
export const PREMIUM_THRESHOLD = 0.005;
export const MIN_PERP_VOLUME_USD = 50_000;
export const MIN_POOL_LIQUIDITY_WARN = 10_000;

export const POOL_CACHE_TTL_MS = 6 * 3600 * 1000;
export const REGISTRY_CACHE_TTL_MS = 24 * 3600 * 1000;
export const EXCHANGE_INFO_CACHE_TTL_MS = 3600 * 1000;
export const FUNDING_HISTORY_CACHE_MS = 5 * 60 * 1000;
export const KLINE_CACHE_MS = 5 * 60 * 1000;

export const REFRESH_INTERVAL_MS = 60_000;
export const PERP_REFRESH_INTERVAL_MS = 30_000;

export const STOCK_SORT_LABELS: Record<string, string> = {
  m5: '5M',
  m30: '30M',
  h1: '1H',
  h24: '24H',
  h48: '48H',
  h72: '72H',
  d7: '7D',
};

export const EXCHANGE_META: Record<string, { name: string; color: string }> = {
  binance: { name: 'Binance', color: '#F0B90B' },
  okx: { name: 'OKX', color: '#FFFFFF' },
  gate: { name: 'Gate', color: '#2354E6' },
  bybit: { name: 'Bybit', color: '#F7A600' },
  hyperliquid: { name: 'Hyperliquid', color: '#00D1B2' },
  onchain: { name: 'Robinhood 链上主池', color: '#58a6ff' },
};

export const NYSE_HOLIDAYS: Record<number, string[]> = {
  2026: ['01-01', '01-19', '02-16', '04-03', '05-25', '06-19', '07-03', '09-07', '11-26', '12-25'],
  2027: ['01-01', '01-18', '02-15', '03-26', '05-31', '06-18', '07-05', '09-06', '11-25', '12-24'],
  2028: ['01-17', '02-21', '04-14', '05-29', '06-19', '07-04', '09-04', '11-23', '12-25'],
};

export const NYSE_EARLY_CLOSE: Record<number, string[]> = {
  2026: ['11-27', '12-24'],
  2027: ['11-26'],
  2028: ['07-03', '11-24'],
};

export const SEED_STOCKS: StockToken[] = [
  { address: '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', symbol: 'META', name: 'Meta Platforms', official: true },
  { address: '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', symbol: 'SPCX', name: 'SPCX', official: true },
  { address: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', symbol: 'NVDA', name: 'NVIDIA', official: true },
  { address: '0xccee82fe024c36fa15e1005ede3e9e4787e23d09', symbol: 'HIMS', name: 'Hims & Hers Health', official: true },
  { address: '0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', symbol: 'GLD', name: 'SPDR Gold Shares', official: true },
  { address: '0xec262a75e413fafd0df80480274532c79d42da09', symbol: 'MSTR', name: 'MicroStrategy', official: true },
  { address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', symbol: 'SPY', name: 'SPDR S&P 500 ETF', official: true },
  { address: '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', symbol: 'CRCL', name: 'Circle Online', official: true },
  { address: '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', symbol: 'PLTR', name: 'Palantir Technologies', official: true },
  { address: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', symbol: 'TSLA', name: 'Tesla', official: true },
  { address: '0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344', symbol: 'USO', name: 'United States Oil Fund', official: true },
  { address: '0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', symbol: 'GOOGL', name: 'Alphabet', official: true },
  { address: '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', symbol: 'AMC', name: 'AMC Entertainment', official: true },
  { address: '0xff080c8ce2e5feadaca0da81314ae59d232d4afd', symbol: 'MU', name: 'Micron Technology', official: true },
  { address: '0xc72b96e0e48ecd4dc75e1e45396e26300bc39681', symbol: 'INTC', name: 'Intel', official: true },
  { address: '0x1d11f0496982706c5e14a514d4e79f2e6bde4516', symbol: 'DJT', name: 'Trump Media', official: true },
  { address: '0xf6589f11bc40b669e584073f428b05562f568733', symbol: 'SNAP', name: 'Snap', official: true },
  { address: '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', symbol: 'AAPL', name: 'Apple', official: true },
  { address: '0x6330d8c3178a418788df01a47479c0ce7ccf450b', symbol: 'COIN', name: 'Coinbase', official: true },
  { address: '0x2d427692e928fa156ec22acfabafa0447c5805b7', symbol: 'GLXY', name: 'Galaxy Digital', official: true },
  { address: '0xb90a19ff0af67f7779aff50a882a9cff42446400', symbol: 'SNDK', name: 'SanDisk', official: true },
  { address: '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', symbol: 'QQQ', name: 'Invesco QQQ Trust', official: true },
  { address: '0x92fd66527192e3e61d4ddd13322aa222de86f9b5', symbol: 'SGOV', name: 'iShares 0-3 Month Treasury', official: true },
  { address: '0x1b0e319c6a659f002271b69db8a7df2f911c153e', symbol: 'GME', name: 'GameStop', official: true },
  { address: '0x12f190a9f9d7d37a250758b26824b97ce941bf54', symbol: 'AMZN', name: 'Amazon', official: true },
  { address: '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', symbol: 'AMD', name: 'AMD', official: true },
  { address: '0x8005d266423c7ea827372c9c864491e5786600ea', symbol: 'LLY', name: 'Eli Lilly', official: true },
  { address: '0x980dcf6766fa79f5cf0c4aadb3ab477ff15a9619', symbol: 'IBM', name: 'IBM', official: true },
  { address: '0x4ea005168d7f09a7a0ba9d1def21a479950e44c2', symbol: 'COST', name: 'Costco', official: true },
  { address: '0xe93237c50d904957cf27e7b1133b510c669c2e74', symbol: 'MSFT', name: 'Microsoft', official: true },
  { address: '0x59818904ab4ce163b3ce4ffb64f2d6ca02c434b4', symbol: 'QUBT', name: 'Quantum Computing', official: true },
  { address: '0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8', symbol: 'RBLX', name: 'Roblox', official: true },
  { address: '0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8', symbol: 'NFLX', name: 'Netflix', official: true },
  { address: '0x156e175dd063a8ce274c50654ef40e0032b3fbcf', symbol: 'AVGO', name: 'Broadcom', official: true },
  { address: '0xb0992820e760d836549ba69bc7598b4af75dee03', symbol: 'ORCL', name: 'Oracle', official: true },
  { address: '0x58ffe4a942d3885baa22d7520691f611ef09e7aa', symbol: 'TSM', name: 'TSMC', official: true },
  { address: '0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f', symbol: 'SLV', name: 'iShares Silver Trust', official: true },
  { address: '0x05b37fb53a299a1b874a619e1c4c404d52c36f4c', symbol: 'RDDT', name: 'Reddit', official: true },
  { address: '0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3', symbol: 'CRWV', name: 'CrowdStrike', official: true },
  { address: '0xc01aa1fecec0605b13bc84874ff7256c0f5f562a', symbol: 'SMCI', name: 'Super Micro Computer', official: true },
];
