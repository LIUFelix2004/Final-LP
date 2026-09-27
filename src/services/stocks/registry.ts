import { createPublicClient, http, parseAbiItem, type Address, type Hex } from 'viem';
import type { StockToken } from '../../types/stocks';
import {
  OFFICIAL_BEACON,
  BEACON_SLOT,
  SEED_STOCKS,
  ROBINHOOD_CHAIN_ID,
  REGISTRY_CACHE_TTL_MS,
} from '../../config/stocks';
import { CHAINS } from '../../config/chains';

const ERC20_SYMBOL_ABI = [
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

const ERC20_NAME_ABI = [
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

const robinhoodChain = {
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'] },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const },
  },
} as const;

function getClient() {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl),
    batch: { multicall: true },
  });
}

export async function enumerateOfficialTokens(): Promise<StockToken[]> {
  const client = getClient();

  const logs = await client.getLogs({
    event: parseAbiItem('event BeaconUpgraded(address indexed beacon)'),
    args: { beacon: OFFICIAL_BEACON as Address },
    fromBlock: 0n,
  });

  const addresses = [...new Set(logs.map(log => log.address.toLowerCase()))];
  if (addresses.length === 0) return SEED_STOCKS;

  const symbolCalls = addresses.map(addr => ({
    address: addr as Address,
    abi: ERC20_SYMBOL_ABI,
    functionName: 'symbol' as const,
  }));
  const nameCalls = addresses.map(addr => ({
    address: addr as Address,
    abi: ERC20_NAME_ABI,
    functionName: 'name' as const,
  }));

  const batchSize = 50;
  const tokens: StockToken[] = [];

  for (let i = 0; i < addresses.length; i += batchSize) {
    const symBatch = symbolCalls.slice(i, i + batchSize);
    const nameBatch = nameCalls.slice(i, i + batchSize);
    const [symResults, nameResults] = await Promise.all([
      client.multicall({ contracts: symBatch, allowFailure: true }),
      client.multicall({ contracts: nameBatch, allowFailure: true }),
    ]);
    for (let j = 0; j < symResults.length; j++) {
      const symR = symResults[j];
      const nameR = nameResults[j];
      if (symR.status === 'success' && symR.result) {
        const symbol = symR.result as string;
        const name = nameR.status === 'success' && nameR.result ? (nameR.result as string) : symbol;
        tokens.push({
          address: addresses[i + j],
          symbol,
          name: name.replace(/\s*•\s*Robinhood Token$/, ''),
          official: true,
        });
      }
    }
  }

  return tokens;
}

export async function readTokenSymbolName(address: string): Promise<{ symbol: string; name: string }> {
  const client = getClient();
  const [symResult, nameResult] = await Promise.all([
    client.readContract({ address: address as Address, abi: ERC20_SYMBOL_ABI, functionName: 'symbol' }),
    client.readContract({ address: address as Address, abi: ERC20_NAME_ABI, functionName: 'name' }).catch(() => null),
  ]);
  const symbol = symResult as string;
  const name = nameResult ? (nameResult as string).replace(/\s*•\s*Robinhood Token$/, '') : symbol;
  return { symbol, name };
}

export async function verifyOfficialToken(address: string): Promise<boolean> {
  const client = getClient();
  try {
    const storage = await client.getStorageAt({
      address: address as Address,
      slot: BEACON_SLOT as Hex,
    });
    if (!storage) return false;
    const beaconAddr = `0x${storage.slice(-40)}`.toLowerCase();
    return beaconAddr === OFFICIAL_BEACON.toLowerCase();
  } catch {
    return false;
  }
}

const REGISTRY_CACHE_KEY = 'stocks-registry-v1';
const USER_TOKENS_KEY = 'stocks-user-tokens-v1';

interface RegistryCacheData {
  tokens: StockToken[];
  timestamp: number;
}

export function loadRegistryCache(): StockToken[] | null {
  try {
    const raw = localStorage.getItem(REGISTRY_CACHE_KEY);
    if (!raw) return null;
    const data: RegistryCacheData = JSON.parse(raw);
    if (Date.now() - data.timestamp > REGISTRY_CACHE_TTL_MS) return null;
    return data.tokens;
  } catch {
    return null;
  }
}

export function saveRegistryCache(tokens: StockToken[]): void {
  try {
    const data: RegistryCacheData = { tokens, timestamp: Date.now() };
    localStorage.setItem(REGISTRY_CACHE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

export function loadUserTokens(): StockToken[] {
  try {
    const raw = localStorage.getItem(USER_TOKENS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveUserToken(token: StockToken): void {
  const existing = loadUserTokens();
  if (existing.some(t => t.address.toLowerCase() === token.address.toLowerCase())) return;
  existing.push(token);
  try {
    localStorage.setItem(USER_TOKENS_KEY, JSON.stringify(existing));
  } catch { /* quota exceeded */ }
}

export function mergeRegistries(official: StockToken[], user: StockToken[]): StockToken[] {
  const seen = new Set(official.map(t => t.address.toLowerCase()));
  const merged = [...official];
  for (const t of user) {
    if (!seen.has(t.address.toLowerCase())) {
      merged.push(t);
      seen.add(t.address.toLowerCase());
    }
  }
  return merged;
}
