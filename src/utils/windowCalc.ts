import type { PoolData, TimeWindow } from '../types';
import type { VolumeSampler } from '../services/sampler';
import { computeFeeTvlRatio, estimateFeeUsdFromRate } from './format';

export function applyTimeWindow(
  pools: PoolData[],
  window: TimeWindow,
  sampler?: VolumeSampler,
): PoolData[] {
  return pools.map((p) => {
    let volume: number | null;
    let txCount: number | null;

    if (window === 'm15') {
      const est = sampler?.estimate15m(p.pairAddress, p.chainId);
      volume = est?.value ?? null;
      txCount = null;
    } else {
      const w = p.windows[window];
      volume = w.volume;
      txCount = w.txCount;
    }

    const feeUsd = estimateFeeUsdFromRate(volume, p.feeRate);
    const feeTvlRatio = computeFeeTvlRatio(feeUsd, p.tvlUsd);

    return { ...p, volumeUsd: volume, feeUsd, feeTvlRatio, txCount };
  });
}
