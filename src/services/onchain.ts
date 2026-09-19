import { createPublicClient, http, type Address } from 'viem';
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

// UP33 CL factory on Robinhood
const UP33_CL_FACTORY = '0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3' as const;

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

export async function enrichV3FeeRates(
  pools: PoolData[],
  chainId: number,
): Promise<PoolData[]> {
  const v3Pools = pools.filter(
    (p) =>
      (p.version === 'V3' || p.version === 'V4') &&
      p.feeRate === null,
  );

  if (v3Pools.length === 0) return pools;

  const client = getClient(chainId);
  const feeMap = new Map<string, number>();

  // Batch read fee() for standard V3 pools (Uniswap, PancakeSwap)
  const standardV3 = v3Pools.filter(
    (p) => p.dex !== 'UP33' && p.version === 'V3',
  );

  if (standardV3.length > 0) {
    const calls = standardV3.map((p) => ({
      address: p.pairAddress as Address,
      abi: V3_POOL_FEE_ABI,
      functionName: 'fee' as const,
    }));

    try {
      const results = await client.multicall({ contracts: calls });
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'success' && result.result != null) {
          // Uni V3 fee is in hundredths of a bip (e.g. 3000 = 0.30%)
          const feeBps = Number(result.result);
          feeMap.set(standardV3[i].id, feeBps / 10000);
        }
      }
    } catch (err) {
      console.warn('Multicall fee() failed for standard V3:', err);
    }
  }

  // UP33 Slipstream: read tickSpacing, then tickSpacingToFee from factory
  const slipstreamPools = v3Pools.filter(
    (p) => p.dex === 'UP33' && p.version === 'V3',
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

  if (feeMap.size === 0) return pools;

  return pools.map((p) => {
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
