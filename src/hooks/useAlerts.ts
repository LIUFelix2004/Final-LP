import { useState, useRef, useCallback, useEffect } from 'react';
import type { PoolData } from '../types';
import {
  type AlertSettings,
  type SpikeAlert,
  SpikeDetector,
  loadAlertSettings,
  saveAlertSettings,
  sendWebhook,
  sendBrowserNotification,
} from '../services/alerts';

export function useAlerts() {
  const [settings, setSettingsState] = useState<AlertSettings>(loadAlertSettings);
  const [toasts, setToasts] = useState<SpikeAlert[]>([]);
  const detectorRef = useRef(new SpikeDetector());

  const updateSettings = useCallback((patch: Partial<AlertSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveAlertSettings(next);
      return next;
    });
  }, []);

  const checkSpikes = useCallback(
    (pools: PoolData[], watchlistedAddrs: Set<string>) => {
      const alerts = detectorRef.current.detect(pools, watchlistedAddrs, settings);
      if (alerts.length === 0) return;

      setToasts((prev) => [...prev, ...alerts].slice(-10));

      for (const alert of alerts) {
        sendBrowserNotification(alert);
        if (settings.webhookUrl) {
          sendWebhook(settings.webhookUrl, alert);
        }
      }
    },
    [settings],
  );

  const dismissToast = useCallback((idx: number) => {
    setToasts((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
    detectorRef.current.clearCooldowns();
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 12_000);
    return () => clearTimeout(timer);
  }, [toasts]);

  return {
    settings,
    updateSettings,
    checkSpikes,
    toasts,
    dismissToast,
    clearToasts,
  };
}
