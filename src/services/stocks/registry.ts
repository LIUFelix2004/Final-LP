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
import snapshotJson from '../../config/stock-registry.json';

const REGISTRY_SEGMENT_SIZE = 30000n;
const SCAN_PROGRESS_KEY = 'stocks-registry-scan-v1';
const SCAN_INTER_SEGMENT_DELAY = 200;
const SCAN_MAX_RETRIES = 5;

interface ScanProgress {
  lastBlock: number;
  extraAddresses: string[];
}

function loadScanProgress(): ScanProgress | null {
  try {
    const raw = localStorage.getItem(SCAN_PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveScanProgress(block: bigint, extraAddresses: string[]): void {
  try {
    localStorage.setItem(SCAN_PROGRESS_KEY, JSON.stringify({
      lastBlock: Number(block),
      extraAddresses,
    }));
  } catch {}
}

function is429Error(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('429') || msg.includes('Too Many') || msg.includes('Failed to fetch') || msg.includes('CORS');
}

async function withScanRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= SCAN_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (is429Error(err) && attempt < SCAN_MAX_RETRIES) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`[registry] ${label} attempt ${attempt + 1} failed (429), waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: retries exhausted`);
}

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

export interface RegistryResult {
  tokens: StockToken[];
  degraded: boolean;
}

function isBlockRangeError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('-32602') || msg.includes('query spans') || msg.includes('block range');
}

function loadSnapshot(): StockToken[] {
  try {
    const tokens: StockToken[] = (snapshotJson as { tokens: Array<{ address: string; symbol: string; name: string; official: boolean }> }).tokens.map(t => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      official: t.official,
    }));
    return tokens.length > 0 ? tokens : SEED_STOCKS;
  } catch {
    return SEED_STOCKS;
  }
}

const snapshotBlock = BigInt((snapshotJson as { snapshotBlock: number }).snapshotBlock || 0);

const REGISTRY_RETRY_DELAYS = [2000, 5000, 10000];

export function loadSnapshotTokens(): StockToken[] {
  return loadSnapshot();
}

export function getSnapshotTokenCount(): number {
  return loadSnapshot().length;
}

export async function enumerateOfficialTokens(): Promise<RegistryResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= REGISTRY_RETRY_DELAYS.length; attempt++) {
    try {
      const tokens = await enumerateOfficialTokensInner();
      return { tokens, degraded: false };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isBlockRangeError(err)) {
        break;
      }
      if (attempt < REGISTRY_RETRY_DELAYS.length) {
        await new Promise(r => setTimeout(r, REGISTRY_RETRY_DELAYS[attempt]));
      }
    }
  }

  console.warn('[registry] all retries failed, returning snapshot:', lastError?.message);
  return { tokens: loadSnapshot(), degraded: true };
}

export async function scanNewTokens(knownAddresses: Set<string>): Promise<StockToken[]> {
  const client = getClient();
  const currentBlock = await client.getBlockNumber();

  const progress = loadScanProgress();
  const progressBlock = progress ? BigInt(progress.lastBlock) : 0n;
  const fromBlock = progressBlock > snapshotBlock ? progressBlock + 1n : (snapshotBlock > 0n ? snapshotBlock : 0n);

  if (fromBlock > currentBlock) return [];

  const newAddresses: string[] = [];
  let cursor = fromBlock;
  while (cursor <= currentBlock) {
    const end = cursor + REGISTRY_SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + REGISTRY_SEGMENT_SIZE - 1n;
    const logs = await withScanRetry(
      () => client.getLogs({
        event: parseAbiItem('event BeaconUpgraded(address indexed beacon)'),
        args: { beacon: OFFICIAL_BEACON as Address },
        fromBlock: cursor,
        toBlock: end,
      }),
      `scanNewTokens ${cursor}-${end}`,
    );
    for (const log of logs) {
      const addr = log.address.toLowerCase();
      if (!knownAddresses.has(addr)) {
        newAddresses.push(addr);
        knownAddresses.add(addr);
      }
    }
    const extraAddresses = [...knownAddresses].filter(a => !new Set(loadSnapshot().map(t => t.address.toLowerCase())).has(a));
    saveScanProgress(end, extraAddresses);
    cursor = end + 1n;
    await new Promise(r => setTimeout(r, SCAN_INTER_SEGMENT_DELAY));
  }

  if (newAddresses.length === 0) return [];

  const tokens: StockToken[] = [];
  for (let i = 0; i < newAddresses.length; i += 50) {
    const batch = newAddresses.slice(i, i + 50);
    const symCalls = batch.map(addr => ({ address: addr as Address, abi: ERC20_SYMBOL_ABI, functionName: 'symbol' as const }));
    const nameCalls = batch.map(addr => ({ address: addr as Address, abi: ERC20_NAME_ABI, functionName: 'name' as const }));
    const [symResults, nameResults] = await withScanRetry(
      () => Promise.all([
        client.multicall({ contracts: symCalls, allowFailure: true }),
        client.multicall({ contracts: nameCalls, allowFailure: true }),
      ]),
      `scanNewTokens metadata ${i}`,
    );
    for (let j = 0; j < symResults.length; j++) {
      const symR = symResults[j];
      const nameR = nameResults[j];
      if (symR.status === 'success' && symR.result) {
        const symbol = symR.result as string;
        const name = nameR.status === 'success' && nameR.result ? (nameR.result as string).replace(/\s*•\s*Robinhood Token$/, '') : symbol;
        tokens.push({ address: batch[j], symbol, name, official: true });
      }
    }
  }

  return tokens;
}

async function enumerateOfficialTokensInner(): Promise<StockToken[]> {
  const client = getClient();
  const currentBlock = await client.getBlockNumber();

  const addresses = new Set<string>();

  for (const t of loadSnapshot()) {
    addresses.add(t.address.toLowerCase());
  }

  const progress = loadScanProgress();
  const progressBlock = progress ? BigInt(progress.lastBlock) : 0n;
  if (progress) {
    for (const addr of progress.extraAddresses) {
      addresses.add(addr.toLowerCase());
    }
  }

  const fromBlock = progressBlock > snapshotBlock ? progressBlock + 1n : (snapshotBlock > 0n ? snapshotBlock : 0n);
  const snapshotAddrs = new Set(loadSnapshot().map(t => t.address.toLowerCase()));

  let cursor = fromBlock;
  while (cursor <= currentBlock) {
    const end = cursor + REGISTRY_SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + REGISTRY_SEGMENT_SIZE - 1n;
    const logs = await withScanRetry(
      () => client.getLogs({
        event: parseAbiItem('event BeaconUpgraded(address indexed beacon)'),
        args: { beacon: OFFICIAL_BEACON as Address },
        fromBlock: cursor,
        toBlock: end,
      }),
      `enumerate ${cursor}-${end}`,
    );
    for (const log of logs) {
      addresses.add(log.address.toLowerCase());
    }
    const extraAddresses = [...addresses].filter(a => !snapshotAddrs.has(a));
    saveScanProgress(end, extraAddresses);
    cursor = end + 1n;
    await new Promise(r => setTimeout(r, SCAN_INTER_SEGMENT_DELAY));
  }

  if (addresses.size === 0) return loadSnapshot();

  const addrArr = [...addresses];
  const symbolCalls = addrArr.map(addr => ({
    address: addr as Address,
    abi: ERC20_SYMBOL_ABI,
    functionName: 'symbol' as const,
  }));
  const nameCalls = addrArr.map(addr => ({
    address: addr as Address,
    abi: ERC20_NAME_ABI,
    functionName: 'name' as const,
  }));

  const batchSize = 50;
  const tokens: StockToken[] = [];

  for (let i = 0; i < addrArr.length; i += batchSize) {
    const symBatch = symbolCalls.slice(i, i + batchSize);
    const nameBatch = nameCalls.slice(i, i + batchSize);
    const [symResults, nameResults] = await withScanRetry(
      () => Promise.all([
        client.multicall({ contracts: symBatch, allowFailure: true }),
        client.multicall({ contracts: nameBatch, allowFailure: true }),
      ]),
      `enumerate metadata ${i}`,
    );
    for (let j = 0; j < symResults.length; j++) {
      const symR = symResults[j];
      const nameR = nameResults[j];
      if (symR.status === 'success' && symR.result) {
        const symbol = symR.result as string;
        const name = nameR.status === 'success' && nameR.result ? (nameR.result as string) : symbol;
        tokens.push({
          address: addrArr[i + j],
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

export function removeUserToken(address: string): void {
  const existing = loadUserTokens();
  const filtered = existing.filter(t => t.address.toLowerCase() !== address.toLowerCase());
  try {
    localStorage.setItem(USER_TOKENS_KEY, JSON.stringify(filtered));
  } catch {}
}

export function searchRegistryBySymbol(registry: StockToken[], query: string): StockToken | null {
  const q = query.toUpperCase().trim();
  if (!q) return null;
  return registry.find(t => t.symbol.toUpperCase() === q) ?? null;
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
