import { describe, it, expect } from 'vitest';
import {
  median,
  computeFairPrice,
  computePremium,
  annualizeFunding,
  funding8hEquivalent,
  bucketFunding8h,
  bucketFunding8hMultiExchange,
  bestShortExchange,
  bestLongExchange,
  buildSignals,
} from './fairPrice';
import type { PerpQuote, FundingPoint, MarketSession } from '../../types/stocks';

function makeQuote(overrides: Partial<PerpQuote> = {}): PerpQuote {
  return {
    exchange: 'binance',
    symbol: 'AAPL',
    contract: 'AAPLUSDT',
    lastPrice: 200,
    markPrice: 200,
    indexPrice: 200,
    volume24h: 100_000,
    fundingRate: 0.0001,
    fundingIntervalHours: 8,
    nextFundingTime: null,
    ...overrides,
  };
}

describe('median', () => {
  it('returns null for empty array', () => {
    expect(median([])).toBeNull();
  });

  it('returns single element', () => {
    expect(median([5])).toBe(5);
  });

  it('returns middle for odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns average for even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('filters non-finite values', () => {
    expect(median([NaN, 1, Infinity, 3, -Infinity])).toBe(2);
  });

  it('returns null if all non-finite', () => {
    expect(median([NaN, Infinity])).toBeNull();
  });
});

describe('computeFairPrice', () => {
  it('computes median of mark prices from valid quotes', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', markPrice: 200 }),
      makeQuote({ exchange: 'okx', markPrice: 202 }),
      makeQuote({ exchange: 'gate', markPrice: 204 }),
    ];
    const result = computeFairPrice(quotes);
    expect(result.fair).toBe(202);
    expect(result.participatingExchanges).toEqual(['binance', 'okx', 'gate']);
  });

  it('excludes quotes with null/zero mark price', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', markPrice: 200 }),
      makeQuote({ exchange: 'okx', markPrice: null }),
      makeQuote({ exchange: 'gate', markPrice: 0 }),
    ];
    const result = computeFairPrice(quotes);
    expect(result.fair).toBe(200);
    expect(result.participatingExchanges).toEqual(['binance']);
    expect(result.excludedExchanges).toHaveLength(2);
  });

  it('excludes quotes below volume threshold', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', markPrice: 200, volume24h: 100_000 }),
      makeQuote({ exchange: 'okx', markPrice: 220, volume24h: 1_000 }),
    ];
    const result = computeFairPrice(quotes);
    expect(result.fair).toBe(200);
    expect(result.excludedExchanges.find(e => e.exchange === 'okx')).toBeTruthy();
  });

  it('returns null fair when no quotes pass', () => {
    const result = computeFairPrice([]);
    expect(result.fair).toBeNull();
    expect(result.participatingExchanges).toHaveLength(0);
  });
});

describe('computePremium', () => {
  it('computes onchain/fair - 1', () => {
    expect(computePremium(205, 200)).toBeCloseTo(0.025, 5);
  });

  it('returns null for null inputs', () => {
    expect(computePremium(null, 200)).toBeNull();
    expect(computePremium(200, null)).toBeNull();
  });

  it('returns null when fair is 0', () => {
    expect(computePremium(200, 0)).toBeNull();
  });

  it('handles discount (negative premium)', () => {
    expect(computePremium(195, 200)).toBeCloseTo(-0.025, 5);
  });
});

describe('annualizeFunding', () => {
  it('annualizes 8h interval', () => {
    expect(annualizeFunding(0.0001, 8)).toBeCloseTo(0.0001 * 3 * 365, 6);
  });

  it('annualizes 1h interval', () => {
    expect(annualizeFunding(0.0001, 1)).toBeCloseTo(0.0001 * 24 * 365, 6);
  });
});

describe('funding8hEquivalent', () => {
  it('converts 1h rate to 8h equivalent', () => {
    expect(funding8hEquivalent(0.0001, 1)).toBeCloseTo(0.0001 * 8, 6);
  });

  it('keeps 8h rate unchanged', () => {
    expect(funding8hEquivalent(0.0001, 8)).toBeCloseTo(0.0001, 6);
  });
});

describe('bucketFunding8h', () => {
  it('creates 6 buckets', () => {
    const now = Date.now();
    const points: FundingPoint[] = [
      { time: now - 3600_000, rate: 0.0001 },
      { time: now - 7200_000, rate: 0.0002 },
    ];
    const buckets = bucketFunding8h(points, now, 8);
    expect(buckets).toHaveLength(6);
    expect(buckets[0].label).toBe('T-8h');
  });
});

describe('bucketFunding8hMultiExchange', () => {
  it('creates buckets per exchange', () => {
    const now = Date.now();
    const allPoints = {
      binance: {
        points: [{ time: now - 3600_000, rate: 0.0001 }],
        intervalHours: 8,
      },
      okx: {
        points: [{ time: now - 3600_000, rate: 0.0002 }],
        intervalHours: 8,
      },
    };
    const buckets = bucketFunding8hMultiExchange(allPoints, now);
    expect(buckets).toHaveLength(6);
    expect(buckets[0].rates.binance).not.toBeUndefined();
    expect(buckets[0].rates.okx).not.toBeUndefined();
  });
});

describe('bucketFunding8hMultiExchange – HL 48-point', () => {
  it('sums 8 hourly rates into each 8h bucket (0.00000625×8=0.00005)', () => {
    const baseTime = Date.UTC(2025, 0, 2, 0, 0, 0);
    const points: FundingPoint[] = [];
    for (let i = 0; i < 48; i++) {
      points.push({ time: baseTime + i * 3600_000, rate: 0.00000625 });
    }
    const now = baseTime + 48 * 3600_000;
    const allPoints = {
      hyperliquid: { points, intervalHours: 1 },
    };
    const buckets = bucketFunding8hMultiExchange(allPoints, now);
    expect(buckets).toHaveLength(6);
    for (const bucket of buckets) {
      if (bucket.rates.hyperliquid !== null) {
        expect(bucket.rates.hyperliquid).toBeCloseTo(0.00005, 8);
      }
    }
  });
});

describe('bestShortExchange', () => {
  it('returns quote with highest annualized funding (short earns positive)', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', fundingRate: 0.001, fundingIntervalHours: 8, volume24h: 200_000 }),
      makeQuote({ exchange: 'okx', fundingRate: 0.002, fundingIntervalHours: 8, volume24h: 200_000 }),
    ];
    const best = bestShortExchange(quotes);
    expect(best?.exchange).toBe('okx');
  });

  it('returns null for empty quotes', () => {
    expect(bestShortExchange([])).toBeNull();
  });

  it('filters by volume threshold', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', fundingRate: 0.005, volume24h: 1_000 }),
    ];
    expect(bestShortExchange(quotes)).toBeNull();
  });
});

describe('bestLongExchange', () => {
  it('returns quote with lowest annualized funding', () => {
    const quotes = [
      makeQuote({ exchange: 'binance', fundingRate: 0.001, fundingIntervalHours: 8, volume24h: 200_000 }),
      makeQuote({ exchange: 'okx', fundingRate: -0.001, fundingIntervalHours: 8, volume24h: 200_000 }),
    ];
    const best = bestLongExchange(quotes);
    expect(best?.exchange).toBe('okx');
  });
});

describe('buildSignals', () => {
  const regularSession: MarketSession = { state: 'regular', label: '盘中', etTime: '10:00' };
  const closedSession: MarketSession = { state: 'closed', label: '美股休市', etTime: '22:00', reason: 'overnight' };

  it('produces green signal for premium within threshold', () => {
    const signals = buildSignals(0.003, 200, 199.4, 3, 50_000, regularSession, null, null);
    expect(signals.some(s => s.color === 'green' && s.text.includes('不吃亏'))).toBe(true);
  });

  it('produces red signal for high positive premium', () => {
    const signals = buildSignals(0.02, 204, 200, 3, 50_000, regularSession, null, null);
    expect(signals.some(s => s.color === 'red' && s.text.includes('溢价'))).toBe(true);
  });

  it('produces blue signal for negative premium (discount)', () => {
    const signals = buildSignals(-0.02, 196, 200, 3, 50_000, regularSession, null, null);
    expect(signals.some(s => s.color === 'blue' && s.text.includes('折价'))).toBe(true);
  });

  it('adds warning when market is closed', () => {
    const signals = buildSignals(null, null, null, 0, null, closedSession, null, null);
    expect(signals.some(s => s.color === 'orange' && s.text.includes('美股'))).toBe(true);
  });

  it('adds warning for low liquidity', () => {
    const signals = buildSignals(0.001, 200, 199.8, 3, 5_000, regularSession, null, null);
    expect(signals.some(s => s.color === 'orange' && s.text.includes('流动性不足'))).toBe(true);
  });

  it('shows no-perp message when count is 0', () => {
    const signals = buildSignals(null, null, null, 0, 50_000, regularSession, null, null);
    expect(signals.some(s => s.text.includes('无永续合约'))).toBe(true);
  });

  it('includes short/long best exchange signals', () => {
    const shortBest = makeQuote({ exchange: 'binance', fundingRate: 0.001, volume24h: 200_000, contract: 'AAPLUSDT' });
    const longBest = makeQuote({ exchange: 'okx', fundingRate: -0.001, volume24h: 200_000, contract: 'AAPL-USDT-SWAP' });
    const signals = buildSignals(0.001, 200, 199.8, 2, 50_000, regularSession, shortBest, longBest);
    expect(signals.some(s => s.text.includes('开空'))).toBe(true);
    expect(signals.some(s => s.text.includes('开多'))).toBe(true);
  });
});
