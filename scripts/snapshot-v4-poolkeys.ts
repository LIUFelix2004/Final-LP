import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const USDG_ADDRESS = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'.toLowerCase();
const STATE_VIEW = '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const SEGMENT_SIZE = 10_000_000n;

const INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
);

const SLOT0_ABI = [
  {
    inputs: [{ name: 'manager', type: 'address' }, { name: 'key', type: 'tuple', components: [
      { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' },
    ]}],
    name: 'getSlot0',
    outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }],
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

async function main() {
  const client = createPublicClient({ chain, transport: http(RPC_URL), batch: { multicall: true } });
  const currentBlock = await client.getBlockNumber();
  console.log(`Chain height: ${currentBlock}`);

  const registryPath = resolve(__dirname, '../src/config/stock-registry.json');
  const registryJson = JSON.parse(readFileSync(registryPath, 'utf-8'));
  const tokenAddresses = new Set<string>(
    (registryJson.tokens as Array<{ address: string }>).map(t => t.address.toLowerCase())
  );
  console.log(`Registry has ${tokenAddresses.size} tokens`);

  const allKeys = new Map<string, PoolKeyEntry>();
  let cursor = 0n;

  while (cursor <= currentBlock) {
    const end = cursor + SEGMENT_SIZE - 1n > currentBlock ? currentBlock : cursor + SEGMENT_SIZE - 1n;
    const logs = await client.getLogs({
      address: POOL_MANAGER as Address,
      event: INITIALIZE_EVENT,
      fromBlock: cursor,
      toBlock: end,
    });

    for (const log of logs) {
      const { id, currency0, currency1, fee, tickSpacing, hooks } = log.args;
      if (!id || !currency0 || !currency1) continue;

      const c0 = currency0.toLowerCase();
      const c1 = currency1.toLowerCase();
      const isUsdgPool = c0 === USDG_ADDRESS || c1 === USDG_ADDRESS;
      if (!isUsdgPool) continue;
      const otherToken = c0 === USDG_ADDRESS ? c1 : c0;
      if (!tokenAddresses.has(otherToken)) continue;

      allKeys.set(id.toLowerCase(), {
        currency0: currency0,
        currency1: currency1,
        fee: fee ?? 0,
        tickSpacing: tickSpacing ?? 0,
        hooks: hooks ?? '0x0000000000000000000000000000000000000000',
      });
    }

    if (Number(cursor) % 10_000_000 === 0) {
      console.log(`Scanned to block ${end}, found ${allKeys.size} USDG V4 pool keys`);
    }
    cursor = end + 1n;
  }

  console.log(`Found ${allKeys.size} USDG V4 pool keys total. Verifying on-chain...`);

  const poolIds = [...allKeys.keys()];
  const verified = new Map<string, PoolKeyEntry>();

  for (let i = 0; i < poolIds.length; i += 20) {
    const batch = poolIds.slice(i, i + 20);
    const calls = batch.map(poolId => {
      const entry = allKeys.get(poolId)!;
      return {
        address: STATE_VIEW as Address,
        abi: SLOT0_ABI,
        functionName: 'getSlot0' as const,
        args: [POOL_MANAGER as Address, {
          currency0: entry.currency0 as Address,
          currency1: entry.currency1 as Address,
          fee: entry.fee,
          tickSpacing: entry.tickSpacing,
          hooks: entry.hooks as Address,
        }] as const,
      };
    });

    const results = await client.multicall({ contracts: calls, allowFailure: true });
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'success' && r.result) {
        const sqrtPriceX96 = r.result[0] as bigint;
        if (sqrtPriceX96 !== 0n) {
          verified.set(batch[j], allKeys.get(batch[j])!);
        }
      }
    }
    console.log(`Verified ${Math.min(i + 20, poolIds.length)}/${poolIds.length}`);
  }

  console.log(`Verified ${verified.size} active pool keys`);

  const keys: Record<string, PoolKeyEntry> = {};
  for (const [poolId, entry] of verified) {
    keys[poolId] = entry;
  }

  const output = {
    description: 'Static snapshot of V4 pool keys from Initialize events on PoolManager',
    poolManager: POOL_MANAGER,
    snapshotBlock: Number(currentBlock),
    snapshotDate: new Date().toISOString().slice(0, 10),
    note: `Generated from Initialize events on V4 PoolManager. Pool keys are immutable so this snapshot never expires. Update by running: npx tsx scripts/snapshot-v4-poolkeys.ts`,
    keys,
  };

  const outPath = resolve(__dirname, '../src/config/v4-poolkeys.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${verified.size} keys to ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
