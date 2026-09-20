export function formatUsd(value: number | null, opts?: { compact?: boolean; decimals?: number }): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const compact = opts?.compact ?? false;
  const decimals = opts?.decimals;

  if (compact) {
    if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  }

  if (decimals !== undefined) {
    return `$${value.toFixed(decimals)}`;
  }

  if (value < 0.0001 && value > 0) {
    return `$${value.toExponential(2)}`;
  }
  if (value < 1) return `$${value.toFixed(6)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPrice(value: number | null): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  if (value === 0) return '$0';
  if (value < 0.00000001) return `$${value.toExponential(4)}`;
  if (value < 0.0001) return `$${value.toFixed(10)}`;
  if (value < 1) return `$${value.toFixed(6)}`;
  if (value < 1000) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatFeeRate(value: number | null): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${value.toFixed(2)}%`;
}

export function formatPercent(value: number | null): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return `${value.toFixed(4)}%`;
}

export function formatNumber(value: number | null): string {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toLocaleString('en-US');
}

export function computeFeeTvlRatio(feeUsd: number | null, tvlUsd: number | null): number | null {
  if (feeUsd === null || tvlUsd === null || tvlUsd === 0) return null;
  return (feeUsd / tvlUsd) * 100;
}

export function estimateFeeFromBps(volumeUsd: number | null, feeRatePercent: number): number | null {
  if (volumeUsd === null || volumeUsd === 0) return null;
  return volumeUsd * (feeRatePercent / 100);
}

export function estimateFeeUsdFromRate(volume: number | null, feeRatePercent: number | null): number | null {
  if (feeRatePercent === null || !volume) return null;
  return volume * (feeRatePercent / 100);
}
