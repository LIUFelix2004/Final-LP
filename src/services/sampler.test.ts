import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VolumeSampler } from './sampler';

describe('VolumeSampler', () => {
  let sampler: VolumeSampler;
  let now: number;

  beforeEach(() => {
    now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    // Clear sessionStorage for clean tests
    try { sessionStorage.clear(); } catch { /* noop */ }
    sampler = new VolumeSampler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null estimate when no samples recorded', () => {
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBeNull();
    expect(result.bucketsFilled).toBe(0);
  });

  it('returns extrapolated estimate from 1 bucket', () => {
    sampler.record('0xabc', 56, 1000);
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBe(3000);
    expect(result.bucketsFilled).toBe(1);
  });

  it('sums 3 non-overlapping buckets for full 15m estimate', () => {
    // Bucket 3: now-15m to now-10m
    vi.spyOn(Date, 'now').mockReturnValue(now - 12 * 60 * 1000);
    sampler.record('0xabc', 56, 500);

    // Bucket 2: now-10m to now-5m
    vi.spyOn(Date, 'now').mockReturnValue(now - 7 * 60 * 1000);
    sampler.record('0xabc', 56, 800);

    // Bucket 1: now-5m to now
    vi.spyOn(Date, 'now').mockReturnValue(now - 2 * 60 * 1000);
    sampler.record('0xabc', 56, 1200);

    // Now estimate at current time
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBe(500 + 800 + 1200);
    expect(result.bucketsFilled).toBe(3);
  });

  it('extrapolates from 2 buckets', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now - 7 * 60 * 1000);
    sampler.record('0xabc', 56, 600);

    vi.spyOn(Date, 'now').mockReturnValue(now - 2 * 60 * 1000);
    sampler.record('0xabc', 56, 900);

    vi.spyOn(Date, 'now').mockReturnValue(now);
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBe(((600 + 900) / 2) * 3);
    expect(result.bucketsFilled).toBe(2);
  });

  it('ignores zero-volume records', () => {
    sampler.record('0xabc', 56, 0);
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBeNull();
  });

  it('tracks separate pools independently', () => {
    sampler.record('0xabc', 56, 1000);
    sampler.record('0xdef', 56, 2000);

    const r1 = sampler.estimate15m('0xabc', 56);
    const r2 = sampler.estimate15m('0xdef', 56);
    expect(r1.value).toBe(3000);
    expect(r2.value).toBe(6000);
  });

  it('tracks same address on different chains independently', () => {
    sampler.record('0xabc', 56, 1000);
    sampler.record('0xabc', 4663, 500);

    const r1 = sampler.estimate15m('0xabc', 56);
    const r2 = sampler.estimate15m('0xabc', 4663);
    expect(r1.value).toBe(3000);
    expect(r2.value).toBe(1500);
  });

  it('recordBatch records multiple pools', () => {
    sampler.recordBatch([
      { pairAddress: '0xa', chainId: 56, volM5: 100 },
      { pairAddress: '0xb', chainId: 56, volM5: 200 },
    ]);

    expect(sampler.estimate15m('0xa', 56).value).toBe(300);
    expect(sampler.estimate15m('0xb', 56).value).toBe(600);
  });

  it('clearChain removes only that chain', () => {
    sampler.record('0xa', 56, 100);
    sampler.record('0xb', 4663, 200);
    sampler.clearChain(56);

    expect(sampler.estimate15m('0xa', 56).value).toBeNull();
    expect(sampler.estimate15m('0xb', 4663).value).toBe(600);
  });

  it('deduplicates samples within 20s', () => {
    sampler.record('0xabc', 56, 1000);
    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    sampler.record('0xabc', 56, 2000);

    // Only first sample should be recorded
    const result = sampler.estimate15m('0xabc', 56);
    expect(result.value).toBe(3000); // 1000 * 3 extrapolated
  });
});
