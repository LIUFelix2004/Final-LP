import { describe, it, expect } from 'vitest';
import { extractLpFeeFromSlot0, v4FeeToPercent } from './onchain';

describe('extractLpFeeFromSlot0', () => {
  it('returns null for zero slot0 (empty pool)', () => {
    expect(extractLpFeeFromSlot0(0n)).toBeNull();
  });

  it('extracts lpFee from bits 208-231', () => {
    // lpFee = 3000 (0.30%) at bits 208-231
    // 3000n << 208n = lpFee in correct position
    // Add a non-zero sqrtPriceX96 so slot0 is not zero
    const sqrtPrice = 1000000n;
    const slot0 = (3000n << 208n) | sqrtPrice;
    expect(extractLpFeeFromSlot0(slot0)).toBe(3000);
  });

  it('extracts lpFee = 500 (0.05%)', () => {
    const sqrtPrice = 1n;
    const slot0 = (500n << 208n) | sqrtPrice;
    expect(extractLpFeeFromSlot0(slot0)).toBe(500);
  });

  it('extracts lpFee = 10000 (1.00%)', () => {
    const sqrtPrice = 42n;
    const slot0 = (10000n << 208n) | sqrtPrice;
    expect(extractLpFeeFromSlot0(slot0)).toBe(10000);
  });

  it('returns null for dynamic fee flag (>= 0x800000)', () => {
    const dynamicFee = 0x800000n;
    const sqrtPrice = 1n;
    const slot0 = (dynamicFee << 208n) | sqrtPrice;
    expect(extractLpFeeFromSlot0(slot0)).toBeNull();
  });

  it('handles slot0 with tick and protocolFee populated', () => {
    const sqrtPrice = 79228162514264337593543950336n; // ~1.0 price
    const tick = 100n & 0xFFFFFFn; // int24 as uint24
    const protocolFee = 500n;
    const lpFee = 3000n;
    const slot0 = (lpFee << 208n) | (protocolFee << 184n) | (tick << 160n) | sqrtPrice;
    expect(extractLpFeeFromSlot0(slot0)).toBe(3000);
  });
});

describe('v4FeeToPercent', () => {
  it('converts 3000 to 0.30%', () => {
    expect(v4FeeToPercent(3000)).toBeCloseTo(0.30);
  });

  it('converts 500 to 0.05%', () => {
    expect(v4FeeToPercent(500)).toBeCloseTo(0.05);
  });

  it('converts 10000 to 1.00%', () => {
    expect(v4FeeToPercent(10000)).toBeCloseTo(1.00);
  });

  it('converts 100 to 0.01%', () => {
    expect(v4FeeToPercent(100)).toBeCloseTo(0.01);
  });
});
