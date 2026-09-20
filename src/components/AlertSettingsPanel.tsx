import { useState } from 'react';
import type { AlertSettings } from '../services/alerts';
import { requestNotificationPermission } from '../services/alerts';

interface Props {
  settings: AlertSettings;
  onUpdate: (patch: Partial<AlertSettings>) => void;
}

export function AlertSettingsPanel({ settings, onUpdate }: Props) {
  const [open, setOpen] = useState(false);
  const [notifStatus, setNotifStatus] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unavailable',
  );

  const handleRequestNotif = async () => {
    const result = await requestNotificationPermission();
    setNotifStatus(result);
  };

  if (!open) {
    return (
      <div style={{ position: 'relative' }}>
        <button className="alert-toggle-btn" onClick={() => setOpen(true)} title="告警设置">
          {settings.muted ? '🔕' : '🔔'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
    <div className="alert-settings-panel">
      <div className="alert-settings-header">
        <strong>告警设置</strong>
        <button className="toast-close" onClick={() => setOpen(false)}>×</button>
      </div>

      <label className="alert-row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
        />
        启用 5m Fee 告警
      </label>

      <label className="alert-row">
        <input
          type="checkbox"
          checked={settings.muted}
          onChange={(e) => onUpdate({ muted: e.target.checked })}
        />
        静音
      </label>

      <label className="alert-row">
        <input
          type="checkbox"
          checked={settings.watchlistOnly}
          onChange={(e) => onUpdate({ watchlistOnly: e.target.checked })}
        />
        仅自选池触发
      </label>

      <div className="alert-field">
        <label>最低 5m Fee ($)</label>
        <input
          type="number"
          value={settings.minFeeUsd}
          min={0}
          onChange={(e) => onUpdate({ minFeeUsd: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="alert-field">
        <label>涨幅 (%)</label>
        <input
          type="number"
          value={settings.minPct}
          min={0}
          onChange={(e) => onUpdate({ minPct: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="alert-field">
        <label>最低涨额 ($)</label>
        <input
          type="number"
          value={settings.minDeltaUsd}
          min={0}
          onChange={(e) => onUpdate({ minDeltaUsd: Number(e.target.value) || 0 })}
        />
      </div>

      <div className="alert-field">
        <label>冷却 (分钟)</label>
        <input
          type="number"
          value={Math.round(settings.cooldownMs / 60_000)}
          min={1}
          onChange={(e) => onUpdate({ cooldownMs: (Number(e.target.value) || 1) * 60_000 })}
        />
      </div>

      <div className="alert-field">
        <label>Webhook URL</label>
        <input
          type="url"
          placeholder="https://..."
          value={settings.webhookUrl}
          onChange={(e) => onUpdate({ webhookUrl: e.target.value })}
        />
      </div>

      <div className="alert-row">
        <span>浏览器通知: {notifStatus === 'granted' ? '✅ 已授权' : notifStatus === 'denied' ? '❌ 已拒绝' : '未请求'}</span>
        {notifStatus !== 'granted' && notifStatus !== 'denied' && (
          <button className="refresh-btn" onClick={handleRequestNotif}>
            请求权限
          </button>
        )}
      </div>
    </div>
    </div>
  );
}
