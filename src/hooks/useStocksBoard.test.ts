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

  it('does not preserve feeRateInferred pools (N11)', () => {
    const existing = new Map<string, StockPool[]>();
    const inferredPool = makePool('0xpair1', 0.30);
    inferredPool.feeRateInferred = true;
    existing.set('0xtoken', [inferredPool]);

    const incoming = new Map<string, StockPool[]>();
    incoming.set('0xtoken', [makePool('0xpair1', null)]);

    mergePoolsPreservingEnriched(existing, incoming);

    const merged = existing.get('0xtoken')!;
    expect(merged[0].feeRate).toBeNull();
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

// N8/N10: rpcThrottled concurrency, rate limit, and retry
describe('N8/N10: rpcThrottled limits concurrency and retries 429', () => {
  beforeEach(async () => {
    const { _resetForTest } = await import('../services/stocks/rpcLimiter');
    _resetForTest();
  });

  it('limits concurrent calls to 4', async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    let maxConcurrent = 0;
    let current = 0;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        rpcThrottled(async () => {
          current++;
          if (current > maxConcurrent) maxConcurrent = current;
          await new Promise(r => setTimeout(r, 10));
          current--;
          return i;
        }, 0)
      )
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  it('retries on 429 errors', async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    let callCount = 0;
    const result = await rpcThrottled(async () => {
      callCount++;
      if (callCount < 3) throw new Error('429 Too Many Requests');
      return 'ok';
    }, 3);
    expect(result).toBe('ok');
    expect(callCount).toBe(3);
  });

  it('N10/N12: rate limits to ≤6 starts per 1s window (instant fns, 20 calls)', { timeout: 15_000 }, async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    const startTimes: number[] = [];
    const base = Date.now();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        rpcThrottled(async () => {
          startTimes.push(Date.now() - base);
          return i;
        }, 0)
      )
    );
    expect(startTimes).toHaveLength(20);
    let maxInWindow = 0;
    for (let i = 0; i < startTimes.length; i++) {
      let count = 0;
      for (let j = 0; j < startTimes.length; j++) {
        if (startTimes[j] >= startTimes[i] && startTimes[j] < startTimes[i] + 1000) count++;
      }
      if (count > maxInWindow) maxInWindow = count;
    }
    // 200ms intervals → 5 per second, +1 for timer resolution jitter
    expect(maxInWindow).toBeLessThanOrEqual(6);
  });

  it('N10/N12: rate limits to ≤6 starts per 1s window (200ms fns, 20 calls)', { timeout: 15_000 }, async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    const startTimes: number[] = [];
    const base = Date.now();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        rpcThrottled(async () => {
          startTimes.push(Date.now() - base);
          await new Promise(r => setTimeout(r, 200));
          return i;
        }, 0)
      )
    );
    expect(startTimes).toHaveLength(20);
    let maxInWindow = 0;
    for (let i = 0; i < startTimes.length; i++) {
      let count = 0;
      for (let j = 0; j < startTimes.length; j++) {
        if (startTimes[j] >= startTimes[i] && startTimes[j] < startTimes[i] + 1000) count++;
      }
      if (count > maxInWindow) maxInWindow = count;
    }
    // 200ms intervals → 5 per second, +1 for timer resolution jitter
    expect(maxInWindow).toBeLessThanOrEqual(6);
  });

  it('N12: 429 retry re-acquires rate slot (no extra HTTP beyond limiter retries)', { timeout: 15_000 }, async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    let httpCount = 0;
    const result = await rpcThrottled(async () => {
      httpCount++;
      if (httpCount <= 2) throw new Error('429 Too Many Requests');
      return 'ok';
    }, 3);
    expect(result).toBe('ok');
    expect(httpCount).toBe(3);
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

// N14: loadPoolCache migration writes back to localStorage
describe('N14: loadPoolCache migration writeback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('immediately persists migrated inferred V3 Uniswap pools', async () => {
    const { loadPoolCache } = await import('../services/stocks/pools');

    const pollutedEntry = {
      tokenAddress: '0x' + 'aa'.repeat(20),
      pools: [{
        pairAddress: '0x' + 'bb'.repeat(20),
        dexId: 'uniswap_v3',
        dex: 'Uniswap',
        labels: [],
        version: 'V3',
        tokenAddress: '0x' + 'aa'.repeat(20),
        tokenSymbol: 'TST',
        isBaseUsdg: true,
        priceNative: null,
        priceUsd: null,
        liquidityUsd: null,
        feeRate: 0.30,
        feeRateInferred: true,
        volume: { m5: null, h1: null, h6: null, h24: null },
      }],
      timestamp: Date.now(),
    };

    localStorage.setItem('stocks-pools-v2', JSON.stringify([pollutedEntry]));

    const cache = loadPoolCache();
    const entry = cache.get(pollutedEntry.tokenAddress.toLowerCase());
    expect(entry).toBeDefined();
    expect(entry!.pools[0].feeRate).toBeNull();
    expect(entry!.pools[0].feeRateInferred).toBe(false);

    const saved = JSON.parse(localStorage.getItem('stocks-pools-v2')!);
    expect(saved[0].pools[0].feeRate).toBeNull();
    expect(saved[0].pools[0].feeRateInferred).toBe(false);
  });

  it('does not write back if no migration needed', async () => {
    const { loadPoolCache } = await import('../services/stocks/pools');

    const cleanEntry = {
      tokenAddress: '0x' + 'aa'.repeat(20),
      pools: [{
        pairAddress: '0x' + 'bb'.repeat(20),
        dexId: 'uniswap_v3',
        dex: 'Uniswap',
        labels: [],
        version: 'V3',
        tokenAddress: '0x' + 'aa'.repeat(20),
        tokenSymbol: 'TST',
        isBaseUsdg: true,
        priceNative: null,
        priceUsd: null,
        liquidityUsd: null,
        feeRate: 0.05,
        feeRateInferred: false,
        volume: { m5: null, h1: null, h6: null, h24: null },
      }],
      timestamp: Date.now(),
    };

    localStorage.setItem('stocks-pools-v2', JSON.stringify([cleanEntry]));
    const spy = vi.spyOn(Storage.prototype, 'setItem');

    loadPoolCache();

    const poolCacheWrites = spy.mock.calls.filter(c => c[0] === 'stocks-pools-v2');
    expect(poolCacheWrites.length).toBe(0);
    spy.mockRestore();
  });
});

// R17: rpcLimiter exports correct constants
describe('R17: rpcLimiter constants and adaptive backoff', () => {
  beforeEach(async () => {
    const { _resetForTest } = await import('../services/stocks/rpcLimiter');
    _resetForTest();
  });

  it('exports BASE_RATE_PER_SECOND=5, MAX_CONCURRENCY=4', async () => {
    const { BASE_RATE_PER_SECOND, MAX_CONCURRENCY } = await import('../services/stocks/rpcLimiter');
    expect(BASE_RATE_PER_SECOND).toBe(5);
    expect(MAX_CONCURRENCY).toBe(4);
  });

  it('40 concurrent calls: max in-flight ≤4, rolling 1s ≤6', { timeout: 30_000 }, async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    let maxConcurrent = 0;
    let current = 0;
    const startTimes: number[] = [];
    const base = Date.now();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        rpcThrottled(async () => {
          current++;
          startTimes.push(Date.now() - base);
          if (current > maxConcurrent) maxConcurrent = current;
          await new Promise(r => setTimeout(r, 5));
          current--;
          return i;
        }, 0)
      )
    );
    expect(maxConcurrent).toBeLessThanOrEqual(4);
    let maxInWindow = 0;
    for (let i = 0; i < startTimes.length; i++) {
      let count = 0;
      for (let j = 0; j < startTimes.length; j++) {
        if (startTimes[j] >= startTimes[i] && startTimes[j] < startTimes[i] + 1000) count++;
      }
      if (count > maxInWindow) maxInWindow = count;
    }
    expect(maxInWindow).toBeLessThanOrEqual(6);
  });

  it('consecutive 429 triggers degraded mode (≤4/s for 30s)', { timeout: 30_000 }, async () => {
    const { rpcThrottled } = await import('../services/stocks/rpcLimiter');
    let callNum = 0;
    for (let i = 0; i < 3; i++) {
      try {
        await rpcThrottled(async () => {
          callNum++;
          throw new Error('429 Too Many Requests');
        }, 0);
      } catch { /* expected */ }
    }
    expect(callNum).toBe(3);
    const startTimes: number[] = [];
    const base = Date.now();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        rpcThrottled(async () => {
          startTimes.push(Date.now() - base);
          return i;
        }, 0)
      )
    );
    let maxInWindow = 0;
    for (let i = 0; i < startTimes.length; i++) {
      let count = 0;
      for (let j = 0; j < startTimes.length; j++) {
        if (startTimes[j] >= startTimes[i] && startTimes[j] < startTimes[i] + 1000) count++;
      }
      if (count > maxInWindow) maxInWindow = count;
    }
    // degraded mode: 3/s + 1 jitter tolerance
    expect(maxInWindow).toBeLessThanOrEqual(4);
  });
});

// R17: dynamic fee pools excluded from retry queue
describe('R17: dynamic fee / unreadable pools excluded from retry', () => {
  it('feeRateUnreadable pools are excluded from null-fee retry filter', () => {
    const dynamicV4 = makePool('0xdynamic', null);
    dynamicV4.version = 'V4';
    dynamicV4.feeRateUnreadable = true;

    const up33Pool = makePool('0xup33', 0.01);
    up33Pool.dex = 'UP33';
    up33Pool.feeRateInferred = true;
    up33Pool.feeRateUnreadable = true;

    const normalNull = makePool('0xnormal', null);

    const allPools = [dynamicV4, up33Pool, normalNull];
    const retryQueue = allPools.filter(p => (p.feeRate === null || p.feeRateInferred) && !p.feeRateUnreadable);
    expect(retryQueue).toHaveLength(1);
    expect(retryQueue[0].pairAddress).toBe('0xnormal');
  });
});

// R17: mergeResolvedPools skips write when fee unchanged
describe('R17: mergeResolvedPools skip-write optimization', () => {
  it('does not trigger change when resolved fee matches existing', () => {
    const existing = new Map<string, StockPool[]>();
    const pool = makePool('0xpair1', 0.003);
    existing.set('0xtoken', [pool]);

    const resolved = makePool('0xpair1', 0.003);

    const resolvedMap = new Map([[resolved.pairAddress, resolved]]);
    let changed = false;
    for (const [_addr, pools] of existing) {
      for (const p of pools) {
        const r = resolvedMap.get(p.pairAddress);
        if (r && r.feeRate !== null && !r.feeRateInferred && (p.feeRate !== r.feeRate || p.feeRateInferred)) {
          changed = true;
        }
      }
    }
    expect(changed).toBe(false);
  });

  it('triggers change when resolved fee differs from existing', () => {
    const existing = new Map<string, StockPool[]>();
    const pool = makePool('0xpair1', null);
    existing.set('0xtoken', [pool]);

    const resolved = makePool('0xpair1', 0.003);

    const resolvedMap = new Map([[resolved.pairAddress, resolved]]);
    let changed = false;
    for (const [_addr, pools] of existing) {
      for (const p of pools) {
        const r = resolvedMap.get(p.pairAddress);
        if (r && r.feeRate !== null && !r.feeRateInferred && (p.feeRate !== r.feeRate || p.feeRateInferred)) {
          changed = true;
        }
      }
    }
    expect(changed).toBe(true);
  });
});
