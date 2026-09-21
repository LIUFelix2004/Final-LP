import { createPublicClient, http, keccak256, encodePacked, type Address, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import type { PoolData } from '../types';
import { CHAINS } from '../config/chains';
import { computeFeeTvlRatio, estimateFeeFromBps } from '../utils/format';

const V3_POOL_FEE_ABI = [
  {
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// UP33 Slipstream pools use tickSpacing + factory.tickSpacingToFee()
const SLIPSTREAM_POOL_ABI = [
  {
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const SLIPSTREAM_FACTORY_ABI = [
  {
    inputs: [{ name: '', type: 'int24' }],
    name: 'tickSpacingToFee',
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// PoolManager.extsload(bytes32) for reading V4 pool state
const EXTSLOAD_ABI = [
  {
    inputs: [{ name: 'slot', type: 'bytes32' }],
    name: 'extsload',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// UP33 CL factory on Robinhood
const UP33_CL_FACTORY = '0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3' as const;

// Uniswap V4 PoolManager addresses
const V4_POOL_MANAGER: Record<number, Address> = {
  56: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
  4663: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
};

// PoolManager storage: `pools` mapping slot (slot 6 in Uniswap V4 PoolManager)
const POOLS_MAPPING_SLOT = 6n;

// V4 dynamic fee flag: fee >= 0x800000 means hook-controlled dynamic fee
const V4_DYNAMIC_FEE_FLAG = 0x800000;

const robinhoodChain = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [CHAINS[4663]?.rpcUrl || 'https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: CHAINS[4663]?.explorerUrl || 'https://explorer.robinhoodchain.com' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
    },
  },
} as const;

function getClient(chainId: number) {
  if (chainId === 56) {
    return createPublicClient({
      chain: bsc,
      transport: http(CHAINS[56]?.rpcUrl),
      batch: { multicall: true },
    });
  }
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(CHAINS[4663]?.rpcUrl),
    batch: { multicall: true },
  });
}

/**
 * Compute the storage slot for a V4 pool's slot0 in PoolManager.
 * pools mapping: keccak256(abi.encodePacked(poolId, POOLS_MAPPING_SLOT))
 * slot0 is at offset 0 from the base slot.
 */
function v4PoolSlot0StorageSlot(poolId: Hex): Hex {
  return keccak256(
    encodePacked(
      ['bytes32', 'uint256'],
      [poolId as `0x${string}`, POOLS_MAPPING_SLOT],
    ),
  );
}

/**
 * Extract lpFee from V4 pool slot0.
 * slot0 layout (256 bits, packed right to left):
 *   sqrtPriceX96: uint160 (bits 0-159)
 *   tick:         int24   (bits 160-183)
 *   protocolFee:  uint24  (bits 184-207)
 *   lpFee:        uint24  (bits 208-231)
 */
export function extractLpFeeFromSlot0(slot0: bigint): number | null {
  if (slot0 === 0n) return null;
  const lpFee = Number((slot0 >> 208n) & 0xFFFFFFn);
  if (lpFee >= V4_DYNAMIC_FEE_FLAG) return null;
  if (lpFee === 0) return null;
  return lpFee;
}

/**
 * Convert V4 lpFee (hundredths of a bip) to percentage.
 * e.g. 3000 → 0.30%, 500 → 0.05%, 10000 → 1.00%
 */
export function v4FeeToPercent(lpFee: number): number {
  return lpFee / 10000;
}

export async function enrichFeeRates(
  pools: PoolData[],
  chainId: number,
): Promise<PoolData[]> {
  const client = getClient(chainId);
  const feeMap = new Map<string, number>();
  const v4DynamicSet = new Set<string>();

  // --- V3 standard pools (Uniswap, PancakeSwap) ---
  const v3Standard = pools.filter(
    (p) => p.version === 'V3' && p.feeRate === null && p.dex !== 'UP33',
  );

  if (v3Standard.length > 0) {
    const calls = v3Standard.map((p) => ({
      address: p.pairAddress as Address,
      abi: V3_POOL_FEE_ABI,
      functionName: 'fee' as const,
    }));

    try {
      const results = await client.multicall({ contracts: calls });
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'success' && result.result != null) {
          const feeBps = Number(result.result);
          feeMap.set(v3Standard[i].id, feeBps / 10000);
        }
      }
    } catch (err) {
      console.warn(`Multicall fee() failed for V3 on chain ${chainId}:`, err);
    }
  }

  // --- UP33 Slipstream (V3 on Robinhood) ---
  const slipstreamPools = pools.filter(
    (p) => p.dex === 'UP33' && p.version === 'V3' && p.feeRate === null,
  );

  if (slipstreamPools.length > 0 && chainId === 4663) {
    try {
      const tsCalls = slipstreamPools.map((p) => ({
        address: p.pairAddress as Address,
        abi: SLIPSTREAM_POOL_ABI,
        functionName: 'tickSpacing' as const,
      }));

      const tsResults = await client.multicall({ contracts: tsCalls });
      const tickSpacings: Array<{ pool: PoolData; ts: number }> = [];

      for (let i = 0; i < tsResults.length; i++) {
        const r = tsResults[i];
        if (r.status === 'success' && r.result != null) {
          tickSpacings.push({
            pool: slipstreamPools[i],
            ts: Number(r.result),
          });
        }
      }

      if (tickSpacings.length > 0) {
        const feeCalls = tickSpacings.map(({ ts }) => ({
          address: UP33_CL_FACTORY as Address,
          abi: SLIPSTREAM_FACTORY_ABI,
          functionName: 'tickSpacingToFee' as const,
          args: [ts] as const,
        }));

        const feeResults = await client.multicall({ contracts: feeCalls });
        for (let i = 0; i < feeResults.length; i++) {
          const r = feeResults[i];
          if (r.status === 'success' && r.result != null) {
            const feePpm = Number(r.result);
            feeMap.set(tickSpacings[i].pool.id, feePpm / 10000);
          }
        }
      }
    } catch (err) {
      console.warn('Slipstream fee read failed:', err);
    }
  }

  // --- V4 pools: read from PoolManager via extsload ---
  const v4Pools = pools.filter(
    (p) => p.version === 'V4' && p.feeRate === null,
  );

  const poolManager = V4_POOL_MANAGER[chainId];
  if (v4Pools.length > 0 && poolManager) {
    // Best-effort: use pairAddress zero-padded to bytes32 as poolId.
    // DexScreener may use the actual poolId (or a derivative) as pairAddress.
    const extsloadCalls = v4Pools.map((p) => {
      const poolId = `0x${p.pairAddress.replace('0x', '').padStart(64, '0')}` as Hex;
      const storageSlot = v4PoolSlot0StorageSlot(poolId);
      return {
        address: poolManager,
        abi: EXTSLOAD_ABI,
        functionName: 'extsload' as const,
        args: [storageSlot] as const,
      };
    });

    try {
      const results = await client.multicall({ contracts: extsloadCalls });
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'success' && r.result != null) {
          const slot0 = BigInt(r.result as string);
          const lpFee = extractLpFeeFromSlot0(slot0);
          if (lpFee !== null) {
            feeMap.set(v4Pools[i].id, v4FeeToPercent(lpFee));
          } else if (slot0 !== 0n) {
            const rawFee = Number((slot0 >> 208n) & 0xFFFFFFn);
            if (rawFee >= V4_DYNAMIC_FEE_FLAG) {
              v4DynamicSet.add(v4Pools[i].id);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`V4 extsload failed on chain ${chainId}:`, err);
    }
  }

  if (feeMap.size === 0 && v4DynamicSet.size === 0) return pools;

  return pools.map((p) => {
    if (v4DynamicSet.has(p.id)) {
      return { ...p, v4DynamicFee: true } as PoolData;
    }

    const onChainFeePercent = feeMap.get(p.id);
    if (onChainFeePercent === undefined) return p;

    const feeUsd = estimateFeeFromBps(p.volumeUsd, onChainFeePercent);
    return {
      ...p,
      feeRate: onChainFeePercent,
      feeUsd,
      feeTvlRatio: computeFeeTvlRatio(feeUsd, p.tvlUsd),
    };
  });
}

// Backward-compatible alias
export const enrichV3FeeRates = enrichFeeRates;
