import { describe, it, expect } from 'vitest';
import { formatSignedPercent, formatStockPrice } from '../../utils/format';

describe('formatSignedPercent', () => {
  it('formats positive values with + sign', () => {
    expect(formatSignedPercent(0.025)).toBe('+2.50%');
  });

  it('formats negative values with - sign', () => {
    expect(formatSignedPercent(-0.025)).toBe('-2.50%');
  });

  it('formats zero as +0.00%', () => {
    expect(formatSignedPercent(0)).toBe('+0.00%');
  });

  it('returns dash for null', () => {
    expect(formatSignedPercent(null)).toBe('—');
  });

  it('returns dash for NaN', () => {
    expect(formatSignedPercent(NaN)).toBe('—');
  });

  it('returns dash for Infinity', () => {
    expect(formatSignedPercent(Infinity)).toBe('—');
  });

  it('respects custom decimals', () => {
    expect(formatSignedPercent(0.00015, 4)).toBe('+0.0150%');
  });
});

describe('formatStockPrice', () => {
  it('formats price with $ prefix', () => {
    expect(formatStockPrice(200.5)).toBe('$200.50');
  });

  it('returns dash for null', () => {
    expect(formatStockPrice(null)).toBe('—');
  });

  it('returns dash for NaN', () => {
    expect(formatStockPrice(NaN)).toBe('—');
  });
});
