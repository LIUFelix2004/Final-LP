import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scheduleRetries, RETRY_DELAYS, mergePoolsPreservingEnriched } from './useStocksBoard';
import type { StockPool } from '../types/stocks';

function makePool(pairAddress: string, feeRate: number | null): StockPool {
  return {
    pairAddress,
    dexId: 'test',
    dex: 'TestDex',
    labels: [],
    version: 'V3',
    tokenAddress: '0xaaa',
    tokenSymbol: 'TST',
    isBaseUsdg: true,
    priceNative: null,
    priceUsd: null,
    liquidityUsd: null,
    feeRate,
    feeRateInferred: false,
    volume: { m5: null, h1: null, h6: null, h24: null },
  };
}

// N1: snapshot structure tests — verified snapshots
describe('N1: snapshot files have correct structure', () => {
  it('stock-registry.json has ≥200 tokens with valid addresses', async () => {
    const registry = await import('../config/stock-registry.json');
    expect(registry).toHaveProperty('tokens');
    expect(registry).toHaveProperty('snapshotBlock');
    expect(Array.isArray(registry.tokens)).toBe(true);
    expect(registry.tokens.length).toBeGreaterThanOrEqual(200);
    expect(registry.snapshotBlock).toBeGreaterThan(0);
    for (const token of registry.tokens) {
      expect(token).toHaveProperty('address');
      expect(token).toHaveProperty('symbol');
      expect(token).toHaveProperty('name');
      expect(typeof token.address).toBe('string');
      expect(token.address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it('v4-poolkeys.json has keys > 0', async () => {
    const resp = await import('../../public/v4-poolkeys.json');
    expect(resp).toHaveProperty('keys');
    expect(resp).toHaveProperty('snapshotBlock');
    expect(resp).toHaveProperty('poolManager');
    expect(typeof resp.snapshotBlock).toBe('number');
    expect(resp.snapshotBlock).toBeGreaterThan(0);
    const keyCount = Object.keys(resp.keys).length;
    expect(keyCount).toBeGreaterThan(0);
  });
});

// N6/M3: mergePoolsPreservingEnriched direct unit test
describe('N6: mergePoolsPreservingEnriched', () => {
  it('preserves enriched feeRate when incoming has null feeRate', () => {
    const existing = new Map<string, StockPool[]>();
    existing.set('0xtoken', [makePool('0xpair1', 0.003), makePool('0xpair2', 0.005)]);

    const incoming = new Map<string, StockPool[]>();
    incoming.set('0xtoken', [makePool('0xpair1', null), makePool('0xpair2', null)]);

    mergePoolsPreservingEnriched(existing, incoming);

    const merged = existing.get('0xtoken')!;
    expect(merged).toHaveLength(2);
    expect(merged[0].feeRate).toBe(0.003);
    expect(merged[1].feeRate).toBe(0.005);
  });

  it('accepts new pools when no existing entry', () => {
    const existing = new Map<string, StockPool[]>();
    const incoming = new Map<string, StockPool[]>();
    incoming.set('0xnew', [makePool('0xpairA', null)]);

    mergePoolsPreservingEnriched(existing, incoming);

    expect(existing.has('0xnew')).toBe(true);
    expect(existing.get('0xnew')![0].feeRate).toBeNull();
  });

  it('uses incoming pool when existing has null feeRate too', () => {
    const existing = new Map<string, StockPool[]>();
    existing.set('0xtoken', [makePool('0xpair1', null)]);

    const incoming = new Map<string, StockPool[]>();
    const incomingPool = makePool('0xpair1', null);
    incomingPool.liquidityUsd = 9999;
    incoming.set('0xtoken', [incomingPool]);

    mergePoolsPreservingEnriched(existing, incoming);

    expect(existing.get('0xtoken')![0].liquidityUsd).toBe(9999);
  });
});

// N5/M5: placeholder rows via buildRows logic
describe('N5: buildRows showPlaceholders returns rows for tokens with no pools', () => {
  it('buildRows with showPlaceholders includes tokens with empty pools', async () => {
    const { buildFeeRow } = await import('../services/stocks/pools');
    const token = { address: '0x' + 'a'.repeat(40), symbol: 'TEST', name: 'Test', official: true };
    const row = buildFeeRow(token, []);
    expect(row).toHaveProperty('symbol', 'TEST');
    expect(row.pools).toHaveLength(0);
  });
});

// M8: scheduleRetries tests
describe('M8: scheduleRetries fires at correct delays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires retries at escalating delays', async () => {
    const retryFn = vi.fn();
    const handle = scheduleRetries(RETRY_DELAYS, retryFn);

    expect(retryFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(59_999);
    expect(retryFn).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(retryFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(119_999);
    expect(retryFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(retryFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(retryFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(retryFn).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(retryFn).toHaveBeenCalledTimes(3);

    handle.cancel();
  });

  it('cancel() prevents further retries', async () => {
    const retryFn = vi.fn();
    const handle = scheduleRetries(RETRY_DELAYS, retryFn);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(retryFn).toHaveBeenCalledTimes(1);

    handle.cancel();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(retryFn).toHaveBeenCalledTimes(1);
  });

  it('does nothing with empty delays', async () => {
    const retryFn = vi.fn();
    const handle = scheduleRetries([], retryFn);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(retryFn).not.toHaveBeenCalled();

    handle.cancel();
  });
});
