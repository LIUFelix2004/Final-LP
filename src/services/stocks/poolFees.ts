import { createPublicClient, http, keccak256, encodePacked, type Address, type Hex } from 'viem';
import type { StockPool } from '../../types/stocks';
import { CHAINS } from '../../config/chains';
import {
  V4_POOL_MANAGER_ROBINHOOD,
  V4_DYNAMIC_FEE_FLAG,
  POOLS_MAPPING_SLOT,
  UP33_CL_FACTORY,
  ROBINHOOD_CHAIN_ID,
} from '../../config/stocks';
import { rpcThrottled } from './rpcLimiter';

const V3_FEE_ABI = [
  { inputs: [], name: 'fee', outputs: [{ name: '', type: 'uint24' }], stateMutability: 'view', type: 'function' },
] as const;

const SLIPSTREAM_POOL_ABI = [
  { inputs: [], name: 'tickSpacing', outputs: [{ name: '', type: 'int24' }], stateMutability: 'view', type: 'function' },
] as const;

const SLIPSTREAM_FACTORY_ABI = [
  { inputs: [{ name: '', type: 'int24' }], name: 'tickSpacingToFee', outputs: [{ name: '', type: 'uint24' }], stateMutability: 'view', type: 'function' },
] as const;

const EXTSLOAD_ABI = [
  { inputs: [{ name: 'slot', type: 'bytes32' }], name: 'extsload', outputs: [{ name: '', type: 'bytes32' }], stateMutability: 'view', type: 'function' },
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
    transport: http(CHAINS[ROBINHOOD_CHAIN_ID]?.rpcUrl, { retryCount: 0 }),
    batch: { multicall: true },
  });
}

function v4PoolSlot0StorageSlot(poolId: Hex): Hex {
  return keccak256(
    encodePacked(['bytes32', 'uint256'], [poolId as `0x${string}`, POOLS_MAPPING_SLOT]),
  );
}

async function multicallWithRetry<T>(
  client: ReturnType<typeof getClient>,
  contracts: Parameters<ReturnType<typeof getClient>['multicall']>[0]['contracts'],
): Promise<Array<{ status: 'success' | 'failure'; result?: T; error?: Error }>> {
  return rpcThrottled(
    () => client.multicall({ contracts, allowFailure: true }) as Promise<Array<{ status: 'success' | 'failure'; result?: T; error?: Error }>>,
  );
}

export async function enrichStockPoolFees(pools: StockPool[]): Promise<StockPool[]> {
  if (pools.length === 0) return pools;

  const client = getClient();
  const result = [...pools];

  const v4Pools: Array<{ idx: number; pool: StockPool }> = [];
  const upPools: Array<{ idx: number; pool: StockPool }> = [];
  const otherPools: Array<{ idx: number; pool: StockPool }> = [];

  for (let i = 0; i < pools.length; i++) {
    const p = pools[i];
    if (p.feeRate !== null && !p.feeRateInferred) continue;
    if (p.version === 'V4' || p.pairAddress.length === 66) {
      v4Pools.push({ idx: i, pool: p });
    } else if (p.dex === 'UP33') {
      upPools.push({ idx: i, pool: p });
    } else {
      otherPools.push({ idx: i, pool: p });
    }
  }

  if (otherPools.length > 0) {
    const calls = otherPools.map(({ pool }) => ({
      address: pool.pairAddress as Address,
      abi: V3_FEE_ABI,
      functionName: 'fee' as const,
    }));
    try {
      const results = await multicallWithRetry(client, calls);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'success' && r.result != null) {
          const fee = Number(r.result) / 10000;
          result[otherPools[i].idx] = { ...result[otherPools[i].idx], feeRate: fee, feeRateInferred: false };
        }
        // Individual contract revert: leave feeRate null so retry can re-enrich
      }
    } catch {
      // Whole-batch RPC failure (429/network): leave feeRate null for retry
    }
  }

  if (upPools.length > 0) {
    try {
      const feeCalls = upPools.map(({ pool }) => ({
        address: pool.pairAddress as Address,
        abi: V3_FEE_ABI,
        functionName: 'fee' as const,
      }));
      const feeResults = await multicallWithRetry(client, feeCalls);

      const needTickSpacing: Array<{ idx: number; pool: StockPool }> = [];
      for (let i = 0; i < feeResults.length; i++) {
        const r = feeResults[i];
        if (r.status === 'success' && r.result != null && Number(r.result) > 0) {
          const fee = Number(r.result) / 10000;
          result[upPools[i].idx] = { ...result[upPools[i].idx], feeRate: fee, feeRateInferred: false };
        } else {
          needTickSpacing.push(upPools[i]);
        }
      }

      if (needTickSpacing.length > 0) {
        const tsCalls = needTickSpacing.map(({ pool }) => ({
          address: pool.pairAddress as Address,
          abi: SLIPSTREAM_POOL_ABI,
          functionName: 'tickSpacing' as const,
        }));
        const tsResults = await multicallWithRetry(client, tsCalls);
        const tickSpacings: Array<{ origIdx: number; ts: number }> = [];
        for (let i = 0; i < tsResults.length; i++) {
          const r = tsResults[i];
          if (r.status === 'success' && r.result != null) {
            tickSpacings.push({ origIdx: needTickSpacing[i].idx, ts: Number(r.result) });
          }
        }
        if (tickSpacings.length > 0) {
          const tsfCalls = tickSpacings.map(({ ts }) => ({
            address: UP33_CL_FACTORY as Address,
            abi: SLIPSTREAM_FACTORY_ABI,
            functionName: 'tickSpacingToFee' as const,
            args: [ts] as const,
          }));
          const tsfResults = await multicallWithRetry(client, tsfCalls);
          for (let i = 0; i < tsfResults.length; i++) {
            const r = tsfResults[i];
            if (r.status === 'success' && r.result != null) {
              const feePpm = Number(r.result);
              result[tickSpacings[i].origIdx] = { ...result[tickSpacings[i].origIdx], feeRate: feePpm / 10000, feeRateInferred: true };
            }
          }
        }
      }
    } catch { /* UP33 fee read failed */ }
  }

  if (v4Pools.length > 0) {
    const extsloadCalls = v4Pools.map(({ pool }) => {
      const poolId = `0x${pool.pairAddress.replace('0x', '').padStart(64, '0')}` as Hex;
      const storageSlot = v4PoolSlot0StorageSlot(poolId);
      return {
        address: V4_POOL_MANAGER_ROBINHOOD as Address,
        abi: EXTSLOAD_ABI,
        functionName: 'extsload' as const,
        args: [storageSlot] as const,
      };
    });
    try {
      const results2 = await multicallWithRetry(client, extsloadCalls);
      for (let i = 0; i < results2.length; i++) {
        const r = results2[i];
        if (r.status === 'success' && r.result != null) {
          const slot0 = BigInt(r.result as string);
          if (slot0 === 0n) continue;
          const lpFee = Number((slot0 >> 208n) & 0xFFFFFFn);
          if (lpFee >= V4_DYNAMIC_FEE_FLAG) continue;
          if (lpFee === 0) continue;
          result[v4Pools[i].idx] = { ...result[v4Pools[i].idx], feeRate: lpFee / 10000, feeRateInferred: false };
        }
      }
    } catch { /* V4 extsload failed */ }
  }

  return result;
}
