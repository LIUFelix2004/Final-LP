import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PoolData } from '../types';
import { SpikeDetector } from './alerts';
import type { AlertSettings } from './alerts';

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mockStorage.get(k) ?? null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
  });
});

function makePool(overrides: Partial<PoolData> = {}): PoolData {
  return {
    id: 'test-pool',
    pairAddress: '0xtest',
    token0Symbol: 'TOKEN',
    token1Symbol: 'WBNB',
    token0Address: '0x0',
    token1Address: '0x1',
    dex: 'PancakeSwap',
    version: 'V3',
    chainId: 56,
    priceUsd: 1,
    feeRate: 0.3,
    feeUsd: null,
    tvlUsd: 100_000,
    feeTvlRatio: null,
    volumeUsd: null,
    txCount: null,
    pairSymbol: 'TOKEN/WBNB',
    windows: {
      m5: { volume: 100_000, txCount: 50 },
      h1: { volume: 1_000_000, txCount: 500 },
      h6: { volume: 5_000_000, txCount: 2000 },
      h24: { volume: 20_000_000, txCount: 8000 },
    },
    ...overrides,
  };
}

const defaultSettings: AlertSettings = {
  enabled: true,
  watchlistOnly: false,
  minFeeUsd: 50,
  minPct: 100,
  minDeltaUsd: 100,
  cooldownMs: 8 * 60_000,
  webhookUrl: '',
  muted: false,
};

describe('SpikeDetector', () => {
  it('no alert on first observation (no previous fee)', () => {
    const detector = new SpikeDetector();
    const pool = makePool();
    const alerts = detector.detect([pool], new Set(), defaultSettings);
    expect(alerts).toHaveLength(0);
  });

  it('triggers on fee spike exceeding pct threshold', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 20_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts = detector.detect([pool2], new Set(), defaultSettings);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].fee5m).toBeCloseTo(300);
    expect(alerts[0].prevFee5m).toBeCloseTo(60);
    expect(alerts[0].pctChange).toBeCloseTo(400);
  });

  it('triggers on delta exceeding minDeltaUsd', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 50_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts = detector.detect([pool2], new Set(), defaultSettings);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].deltaUsd).toBeCloseTo(150);
  });

  it('no alert below minFeeUsd', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 1_000, txCount: 1 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 10_000, txCount: 5 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts = detector.detect([pool2], new Set(), defaultSettings);
    expect(alerts).toHaveLength(0);
  });

  it('respects cooldown', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 20_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts1 = detector.detect([pool2], new Set(), defaultSettings);
    expect(alerts1).toHaveLength(1);

    const pool3 = makePool({ windows: { m5: { volume: 300_000, txCount: 100 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts2 = detector.detect([pool3], new Set(), defaultSettings);
    expect(alerts2).toHaveLength(0);
  });

  it('fires again after cooldown expires', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 20_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool2], new Set(), defaultSettings);

    detector.clearCooldowns();

    const pool3 = makePool({ windows: { m5: { volume: 500_000, txCount: 200 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts = detector.detect([pool3], new Set(), defaultSettings);
    expect(alerts).toHaveLength(1);
  });

  it('disabled does nothing', () => {
    const detector = new SpikeDetector();
    const pool = makePool();
    detector.detect([pool], new Set(), defaultSettings);
    const alerts = detector.detect([pool], new Set(), { ...defaultSettings, enabled: false });
    expect(alerts).toHaveLength(0);
  });

  it('muted does nothing', () => {
    const detector = new SpikeDetector();
    const pool = makePool();
    detector.detect([pool], new Set(), defaultSettings);
    const alerts = detector.detect([pool], new Set(), { ...defaultSettings, muted: true });
    expect(alerts).toHaveLength(0);
  });

  it('watchlistOnly filters to watched pools', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 20_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(['0xtest']), { ...defaultSettings, watchlistOnly: true });

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alertsWatched = detector.detect([pool2], new Set(['0xtest']), { ...defaultSettings, watchlistOnly: true });
    expect(alertsWatched).toHaveLength(1);
  });

  it('watchlistOnly skips unwatched pools', () => {
    const detector = new SpikeDetector();
    const pool1 = makePool({ windows: { m5: { volume: 20_000, txCount: 10 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool1], new Set(), defaultSettings);

    const pool2 = makePool({ windows: { m5: { volume: 100_000, txCount: 50 }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    const alerts = detector.detect([pool2], new Set(), { ...defaultSettings, watchlistOnly: true });
    expect(alerts).toHaveLength(0);
  });

  it('no alert when feeRate is null', () => {
    const detector = new SpikeDetector();
    const pool = makePool({ feeRate: null });
    detector.detect([pool], new Set(), defaultSettings);
    const alerts = detector.detect([pool], new Set(), defaultSettings);
    expect(alerts).toHaveLength(0);
  });

  it('no alert when m5 volume is null', () => {
    const detector = new SpikeDetector();
    const pool = makePool({ windows: { m5: { volume: null, txCount: null }, h1: { volume: 0, txCount: 0 }, h6: { volume: 0, txCount: 0 }, h24: { volume: 0, txCount: 0 } } });
    detector.detect([pool], new Set(), defaultSettings);
    const alerts = detector.detect([pool], new Set(), defaultSettings);
    expect(alerts).toHaveLength(0);
  });
});
