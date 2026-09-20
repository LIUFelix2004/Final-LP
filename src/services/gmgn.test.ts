import { describe, it, expect } from 'vitest';
import {
  GMGN_CHAIN_SLUG,
  extractTokenAddresses,
  DEFAULT_GMGN_SETTINGS,
} from './gmgn';
import type { GmgnTokenRank } from './gmgn';

function makeRank(overrides: Partial<GmgnTokenRank> = {}): GmgnTokenRank {
  return {
    address: '0xabc123',
    symbol: 'MEME',
    price: 0.05,
    volume: 50000,
    liquidity: 100000,
    market_cap: 500000,
    swaps: 500,
    buys: 300,
    sells: 200,
    smart_buy_24h: 15,
    smart_sell_24h: 2,
    holder_count: 1000,
    open_timestamp: 1695000000,
    is_honeypot: 0,
    buy_tax: '0',
    sell_tax: '0',
    ...overrides,
  };
}

describe('GMGN_CHAIN_SLUG', () => {
  it('maps BSC chainId 56 to bsc', () => {
    expect(GMGN_CHAIN_SLUG[56]).toBe('bsc');
  });

  it('maps Robinhood chainId 4663 to robinhood', () => {
    expect(GMGN_CHAIN_SLUG[4663]).toBe('robinhood');
  });

  it('returns undefined for unsupported chains', () => {
    expect(GMGN_CHAIN_SLUG[1]).toBeUndefined();
  });
});

describe('extractTokenAddresses', () => {
  it('extracts unique lowercase addresses', () => {
    const ranks = [
      makeRank({ address: '0xAAA' }),
      makeRank({ address: '0xBBB' }),
      makeRank({ address: '0xaaa' }),
    ];
    const result = extractTokenAddresses(ranks, DEFAULT_GMGN_SETTINGS);
    expect(result).toEqual(['0xaaa', '0xbbb']);
  });

  it('skips empty addresses', () => {
    const ranks = [
      makeRank({ address: '' }),
      makeRank({ address: '0xABC' }),
    ];
    const result = extractTokenAddresses(ranks, DEFAULT_GMGN_SETTINGS);
    expect(result).toEqual(['0xabc']);
  });

  it('returns empty for empty input', () => {
    expect(extractTokenAddresses([], DEFAULT_GMGN_SETTINGS)).toEqual([]);
  });

  it('preserves order by rank position', () => {
    const ranks = [
      makeRank({ address: '0xFirst', smart_buy_24h: 20 }),
      makeRank({ address: '0xSecond', smart_buy_24h: 10 }),
      makeRank({ address: '0xThird', smart_buy_24h: 5 }),
    ];
    const result = extractTokenAddresses(ranks, DEFAULT_GMGN_SETTINGS);
    expect(result).toEqual(['0xfirst', '0xsecond', '0xthird']);
  });
});

describe('GmgnTokenRank shape', () => {
  it('makeRank produces valid test data', () => {
    const r = makeRank();
    expect(r.smart_buy_24h).toBe(15);
    expect(r.address).toBe('0xabc123');
    expect(r.symbol).toBe('MEME');
    expect(r.is_honeypot).toBe(0);
  });

  it('overrides apply correctly', () => {
    const r = makeRank({ smart_buy_24h: 50, symbol: 'DOGE' });
    expect(r.smart_buy_24h).toBe(50);
    expect(r.symbol).toBe('DOGE');
  });
});
