import type { PoolData } from '../types';

const SETTINGS_KEY = 'lp-alert-settings-v1';
const PREV_FEE_KEY = 'lp-alert-prevfee-v1';

export interface AlertSettings {
  enabled: boolean;
  watchlistOnly: boolean;
  minFeeUsd: number;
  minPct: number;
  minDeltaUsd: number;
  cooldownMs: number;
  webhookUrl: string;
  muted: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  watchlistOnly: true,
  minFeeUsd: 50,
  minPct: 100,
  minDeltaUsd: 100,
  cooldownMs: 8 * 60 * 1000,
  webhookUrl: '',
  muted: false,
};

export interface SpikeAlert {
  pool: PoolData;
  fee5m: number;
  prevFee5m: number;
  pctChange: number;
  deltaUsd: number;
  ts: number;
}

export function loadAlertSettings(): AlertSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_SETTINGS };
    return { ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

export function saveAlertSettings(settings: AlertSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota
  }
}

function loadPrevFees(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PREV_FEE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function savePrevFees(fees: Record<string, number>): void {
  try {
    localStorage.setItem(PREV_FEE_KEY, JSON.stringify(fees));
  } catch {
    // quota
  }
}

export class SpikeDetector {
  private prevFees: Map<string, number>;
  private cooldowns = new Map<string, number>();

  constructor() {
    const stored = loadPrevFees();
    this.prevFees = new Map(Object.entries(stored));
  }

  detect(
    pools: PoolData[],
    watchlistedIds: Set<string>,
    settings: AlertSettings,
  ): SpikeAlert[] {
    if (!settings.enabled || settings.muted) return [];

    const alerts: SpikeAlert[] = [];
    const now = Date.now();

    for (const pool of pools) {
      if (settings.watchlistOnly && !watchlistedIds.has(pool.pairAddress.toLowerCase())) {
        continue;
      }

      const vol5m = pool.windows.m5.volume;
      if (vol5m === null || pool.feeRate === null) continue;

      const fee5m = vol5m * (pool.feeRate / 100);
      if (fee5m < settings.minFeeUsd) continue;

      const key = `${pool.chainId}:${pool.pairAddress.toLowerCase()}`;
      const prev = this.prevFees.get(key);

      if (prev !== undefined && prev > 0) {
        const delta = fee5m - prev;
        const pct = (delta / prev) * 100;

        const cooldownEnd = this.cooldowns.get(key) ?? 0;
        if (now < cooldownEnd) continue;

        if (pct >= settings.minPct || delta >= settings.minDeltaUsd) {
          alerts.push({
            pool,
            fee5m,
            prevFee5m: prev,
            pctChange: pct,
            deltaUsd: delta,
            ts: now,
          });
          this.cooldowns.set(key, now + settings.cooldownMs);
        }
      }

      this.prevFees.set(key, fee5m);
    }

    const obj: Record<string, number> = {};
    for (const [k, v] of this.prevFees) obj[k] = v;
    savePrevFees(obj);

    return alerts;
  }

  clearCooldowns(): void {
    this.cooldowns.clear();
  }
}

export async function sendWebhook(url: string, alert: SpikeAlert): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Fee spike: ${alert.pool.pairSymbol} on chain ${alert.pool.chainId} — 5m fee $${alert.fee5m.toFixed(2)} (+${alert.pctChange.toFixed(0)}%)`,
        chainId: alert.pool.chainId,
        pairAddress: alert.pool.pairAddress,
        pairSymbol: alert.pool.pairSymbol,
        fee5m: alert.fee5m,
        volume5m: alert.pool.windows.m5.volume,
        feeRate: alert.pool.feeRate,
        ts: alert.ts,
      }),
    });
  } catch {
    // soft-fail
  }
}

export function sendBrowserNotification(alert: SpikeAlert): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(`Fee Spike: ${alert.pool.pairSymbol}`, {
      body: `5m Fee: $${alert.fee5m.toFixed(2)} (+${alert.pctChange.toFixed(0)}%) on chain ${alert.pool.chainId}`,
      tag: `spike-${alert.pool.pairAddress}`,
    });
  } catch {
    // not available
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
