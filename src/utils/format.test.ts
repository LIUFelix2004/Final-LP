import { describe, it, expect } from 'vitest';
import { formatUsd, formatPrice, formatFeeRate, formatPercent, computeFeeTvlRatio, formatNumber } from './format';

describe('formatUsd', () => {
  it('returns — for null', () => {
    expect(formatUsd(null)).toBe('—');
  });

  it('formats small values with 6 decimals', () => {
    expect(formatUsd(0.123456)).toBe('$0.123456');
  });

  it('formats large values with commas', () => {
    const result = formatUsd(1234567.89);
    expect(result).toContain('$');
    expect(result).toContain('1,234,567.89');
  });

  it('compact mode shows K', () => {
    expect(formatUsd(5432, { compact: true })).toBe('$5.43K');
  });

  it('compact mode shows M', () => {
    expect(formatUsd(2_500_000, { compact: true })).toBe('$2.50M');
  });

  it('compact mode shows B', () => {
    expect(formatUsd(3_000_000_000, { compact: true })).toBe('$3.00B');
  });

  it('uses scientific notation for very small values', () => {
    const result = formatUsd(0.00001);
    expect(result).toContain('e');
  });
});

describe('formatPrice', () => {
  it('returns — for null', () => {
    expect(formatPrice(null)).toBe('—');
  });

  it('formats meme prices with many decimals', () => {
    const result = formatPrice(0.000001234);
    expect(result).toContain('0.000001');
  });

  it('formats normal prices', () => {
    expect(formatPrice(1.5)).toBe('$1.5000');
  });
});

describe('formatFeeRate', () => {
  it('returns — for null', () => {
    expect(formatFeeRate(null)).toBe('—');
  });

  it('formats fee rate as percentage', () => {
    expect(formatFeeRate(0.3)).toBe('0.30%');
  });

  it('formats 0.25% correctly', () => {
    expect(formatFeeRate(0.25)).toBe('0.25%');
  });
});

describe('formatPercent', () => {
  it('returns — for null', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('formats ratio', () => {
    expect(formatPercent(1.2345)).toBe('1.2345%');
  });
});

describe('formatNumber', () => {
  it('returns — for null', () => {
    expect(formatNumber(null)).toBe('—');
  });

  it('formats with locale separators', () => {
    const result = formatNumber(12345);
    expect(result).toBe('12,345');
  });
});

describe('computeFeeTvlRatio', () => {
  it('returns null when fee is null', () => {
    expect(computeFeeTvlRatio(null, 1000)).toBeNull();
  });

  it('returns null when tvl is null', () => {
    expect(computeFeeTvlRatio(100, null)).toBeNull();
  });

  it('returns null when tvl is 0', () => {
    expect(computeFeeTvlRatio(100, 0)).toBeNull();
  });

  it('computes correct ratio', () => {
    expect(computeFeeTvlRatio(500, 10000)).toBeCloseTo(5.0);
  });

  it('computes small ratio', () => {
    expect(computeFeeTvlRatio(10, 100000)).toBeCloseTo(0.01);
  });

  it('computes large ratio for high-fee/low-tvl pools', () => {
    expect(computeFeeTvlRatio(5000, 1000)).toBeCloseTo(500.0);
  });
});
