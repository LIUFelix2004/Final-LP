import { createPublicClient, http, parseAbiItem, keccak256, encodeAbiParameters, type Address, type Hex } from 'viem';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const SINGLE_TOPIC_SEGMENT = 10_000_000n;
const MAX_RETRIES = 5;
const INTER_REQUEST_DELAY_MS = 100;

const INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
);

const SLOT0_ABI = [
  {
    inputs: [{ name: 'poolId', type: 'bytes32' }],
    name: 'getSlot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'lpFee', type: 'uint24' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const chain = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const } },
} as const;

interface PoolKeyEntry {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function isLimitError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('exceeds limit') || msg.includes('query spans') || msg.includes('-32602') || msg.includes('block range');
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isLimitError(err)) throw err;
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
  keys: Record<string, PoolKeyEntry>;
  lastBlock: number;
}

const CHECKPOINT_PATH = resolve(__dirname, '../.snapshot-v4-checkpoint.json');

function loadCheckpoint(): CheckpointData | null {
  try {
    if (!existsSync(CHECKPOINT_PATH)) return null;
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
  } catch { return null; }
}

function saveCheckpoint(keys: Map<string, PoolKeyEntry>, lastBlock: bigint): void {
  const obj: Record<string, PoolKeyEntry> = {};
  for (const [k, v] of keys) obj[k] = v;
  writeFileSync(CHECKPOINT_PATH, JSON.stringify({ keys: obj, lastBlock: Number(lastBlock) }) + '\n');
}

function computePoolId(key: PoolKeyEntry): string {
  return keccak256(encodeAbiParameters(
    [
      { type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' },
    ],
    [key.currency0 as Address, key.currency1 as Address, key.fee, key.tickSpacing, key.hooks as Address],
  ));
}

async function main() {
  const client = createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } });
  const currentBlock = await withRetry(() => client.getBlockNumber(), 'getBlockNumber');
  console.log(`Chain height: ${currentBlock}`);

  const registryPath = resolve(__dirname, '../src/config/stock-registry.json');
  const registryJson = JSON.parse(readFileSync(registryPath, 'utf-8'));
  const tokenAddresses = new Set<string>(
    (registryJson.tokens as Array<{ address: string }>).map(t => t.address.toLowerCase())
  );
  console.log(`Registry has ${tokenAddresses.size} tokens`);

  const checkpoint = loadCheckpoint();
  const allKeys = new Map<string, PoolKeyEntry>(
    checkpoint ? Object.entries(checkpoint.keys) : []
  );
  let startBlock = checkpoint ? BigInt(checkpoint.lastBlock) + 1n : 0n;
  if (startBlock > 0n) {
    console.log(`Resuming from block ${startBlock} with ${allKeys.size} keys`);
  }

  async function scanRange(
    from: bigint,
    to: bigint,
    args: { currency0: Address } | { currency1: Address },
    label: string,
  ): Promise<void> {
    if (from > to) return;
    try {
      const logs = await withRetry(
        () => client.getLogs({
          address: POOL_MANAGER as Address,
          event: INITIALIZE_EVENT,
          args,
          fromBlock: from,
          toBlock: to,
        }),
        `getLogs ${label} ${from}-${to}`,
      );

      for (const log of logs) {
        const { id, currency0, currency1, fee, tickSpacing, hooks } = log.args;
        if (!id || !currency0 || !currency1) continue;
        const c0 = currency0.toLowerCase();
        const c1 = currency1.toLowerCase();
        const otherToken = c0 === USDG_ADDRESS ? c1 : c0;
        if (!tokenAddresses.has(otherToken)) continue;
        allKeys.set(id.toLowerCase(), {
          currency0,
          currency1,
          fee: fee ?? 0,
          tickSpacing: tickSpacing ?? 0,
          hooks: hooks ?? '0x0000000000000000000000000000000000000000',
        });
      }
      await sleep(INTER_REQUEST_DELAY_MS);
    } catch (err) {
      if (isLimitError(err) && to - from > 1000n) {
        const mid = from + (to - from) / 2n;
        console.log(`  Binary split ${label} ${from}-${to} → ${from}-${mid} + ${mid + 1n}-${to}`);
        await scanRange(from, mid, args, label);
        await scanRange(mid + 1n, to, args, label);
      } else {
        throw err;
      }
    }
  }

  for (const currencyFilter of ['currency0', 'currency1'] as const) {
    let cursor = startBlock;
    while (cursor <= currentBlock) {
      const end = cursor + SINGLE_TOPIC_SEGMENT - 1n > currentBlock ? currentBlock : cursor + SINGLE_TOPIC_SEGMENT - 1n;
      const args = currencyFilter === 'currency0'
        ? { currency0: USDG_ADDRESS as Address }
        : { currency1: USDG_ADDRESS as Address };

      await scanRange(cursor, end, args, currencyFilter);

      console.log(`Scanned ${currencyFilter} to block ${end}, found ${allKeys.size} USDG V4 pool keys`);
      saveCheckpoint(allKeys, end);
      cursor = end + 1n;
    }
  }

  console.log(`Found ${allKeys.size} USDG V4 pool keys total. Verifying poolId and on-chain state...`);

  const poolIds = [...allKeys.keys()];
  const verified = new Map<string, PoolKeyEntry>();
  let mismatchCount = 0;

  for (let i = 0; i < poolIds.length; i += 20) {
    const batch = poolIds.slice(i, i + 20);
    const calls = batch.map(poolId => ({
      address: STATE_VIEW as Address,
      abi: SLOT0_ABI,
      functionName: 'getSlot0' as const,
      args: [poolId as Hex] as const,
    }));

    const results = await withRetry(
      () => client.multicall({ contracts: calls, allowFailure: true }),
      `multicall verify ${i}`,
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const entry = allKeys.get(batch[j])!;
      const recomputed = computePoolId(entry).toLowerCase();
      if (recomputed !== batch[j]) {
        mismatchCount++;
        continue;
      }
      if (r.status === 'success' && r.result) {
        const sqrtPriceX96 = r.result[0] as bigint;
        if (sqrtPriceX96 !== 0n) {
          verified.set(batch[j], entry);
        }
      }
    }
    console.log(`Verified ${Math.min(i + 20, poolIds.length)}/${poolIds.length}`);
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  if (mismatchCount > 0) {
    console.warn(`${mismatchCount} poolId mismatches detected (event id ≠ recomputed)`);
  }
  console.log(`Verified ${verified.size} active pool keys`);

  const keys: Record<string, PoolKeyEntry> = {};
  const sortedIds = [...verified.keys()].sort();
  for (const poolId of sortedIds) {
    keys[poolId] = verified.get(poolId)!;
  }

  const output = {
    description: 'Static snapshot of V4 pool keys from Initialize events on PoolManager',
    poolManager: POOL_MANAGER,
    snapshotBlock: Number(currentBlock),
    snapshotDate: new Date().toISOString().slice(0, 10),
    note: `Generated from Initialize events on V4 PoolManager. Pool keys are immutable so this snapshot never expires. Update by running: npx tsx scripts/snapshot-v4-poolkeys.ts`,
    keys,
  };

  const outPath = resolve(__dirname, '../public/v4-poolkeys.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${verified.size} keys to ${outPath}`);

  try { const fs = await import('fs'); fs.unlinkSync(CHECKPOINT_PATH); } catch {}
}

main().catch(err => { console.error(err); process.exit(1); });
