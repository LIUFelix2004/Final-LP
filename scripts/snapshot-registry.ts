import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OFFICIAL_BEACON = '0xe10b6f6b275de231345c20d14ab812db62151b00';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const SEGMENT_SIZE = 30000n;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const MAX_RETRIES = 5;
const INTER_REQUEST_DELAY_MS = 100;

const ERC20_SYMBOL_ABI = [
  { inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

const ERC20_NAME_ABI = [
  { inputs: [], name: 'name', outputs: [{ name: '', type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

const chain = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: MULTICALL3 } },
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = String(err);
      const is429 = msg.includes('429') || msg.includes('Too Many');
      if (attempt < MAX_RETRIES && (is429 || msg.includes('Failed to fetch'))) {
        const delay = 1000 * 2 ** attempt;
        console.warn(`[retry] ${label} attempt ${attempt + 1} failed (${is429 ? '429' : 'network'}), waiting ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: retries exhausted`);
}

interface CheckpointData {
  addresses: string[];
  lastBlock: number;
}

const CHECKPOINT_PATH = resolve(__dirname, '../.snapshot-registry-checkpoint.json');

function loadCheckpoint(): CheckpointData | null {
  try {
    if (!existsSync(CHECKPOINT_PATH)) return null;
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  } catch { return null; }
}

function saveCheckpoint(addresses: string[], lastBlock: bigint): void {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify({ addresses: [...addresses], lastBlock: Number(lastBlock) }) + '\n');
}

async function main() {
  const fromArg = process.argv.find(a => a.startsWith('--from='));
  const fromBlock = fromArg ? BigInt(fromArg.split('=')[1]) : 0n;

  const client = createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } });
  const currentBlock = await withRetry(() => client.getBlockNumber(), 'getBlockNumber');
  console.log(`Chain height: ${currentBlock}`);

  const checkpoint = loadCheckpoint();
  const addresses = new Set<string>(checkpoint?.addresses ?? []);
  let cursor = checkpoint ? BigInt(checkpoint.lastBlock) + 1n : fromBlock;
  if (cursor > 0n) {
    console.log(`Resuming from block ${cursor} with ${addresses.size} addresses`);
  }

  while (cursor <= currentBlock) {
    const end = cursor + SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + SEGMENT_SIZE - 1n;
    const logs = await withRetry(
      () => client.getLogs({
        event: parseAbiItem('event BeaconUpgraded(address indexed beacon)'),
        args: { beacon: OFFICIAL_BEACON as Address },
        fromBlock: cursor,
        toBlock: end,
      }),
      `getLogs ${cursor}-${end}`,
    );
    for (const log of logs) {
      addresses.add(log.address.toLowerCase());
    }
    if (Number(cursor) % 1_000_000 === 0 || end === currentBlock) {
      console.log(`Scanned to block ${end}, found ${addresses.size} tokens so far`);
      saveCheckpoint([...addresses], end);
    }
    cursor = end + 1n;
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  console.log(`Total unique token addresses: ${addresses.size}`);

  const addrArr = [...addresses];
  const tokens: Array<{ address: string; symbol: string; name: string; official: boolean }> = [];

  for (let i = 0; i < addrArr.length; i += 50) {
    const batch = addrArr.slice(i, i + 50);
    const symCalls = batch.map(addr => ({ address: addr as Address, abi: ERC20_SYMBOL_ABI, functionName: 'symbol' as const }));
    const nameCalls = batch.map(addr => ({ address: addr as Address, abi: ERC20_NAME_ABI, functionName: 'name' as const }));
    const [symResults, nameResults] = await withRetry(
      () => Promise.all([
        client.multicall({ contracts: symCalls, allowFailure: true }),
        client.multicall({ contracts: nameCalls, allowFailure: true }),
      ]),
      `multicall metadata ${i}`,
    );
    for (let j = 0; j < symResults.length; j++) {
      const symR = symResults[j];
      const nameR = nameResults[j];
      if (symR.status === 'success' && symR.result) {
        const symbol = symR.result as string;
        const name = nameR.status === 'success' && nameR.result
          ? (nameR.result as string).replace(/\s*•\s*Robinhood Token$/, '')
          : symbol;
        tokens.push({ address: batch[j], symbol, name, official: true });
      }
    }
    console.log(`Resolved ${Math.min(i + 50, addrArr.length)}/${addrArr.length} token metadata`);
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  const output = {
    description: 'Static snapshot of official Robinhood Chain stock tokens from BeaconUpgraded events',
    snapshotBlock: Number(currentBlock),
    snapshotDate: new Date().toISOString().slice(0, 10),
    note: `Generated from BeaconUpgraded events on OFFICIAL_BEACON ${OFFICIAL_BEACON}. Update by running: npx tsx scripts/snapshot-registry.ts`,
    tokens,
  };

  const outPath = resolve(__dirname, '../src/config/stock-registry.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${tokens.length} tokens to ${outPath}`);

  try { const fs = await import('fs'); fs.unlinkSync(CHECKPOINT_PATH); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
