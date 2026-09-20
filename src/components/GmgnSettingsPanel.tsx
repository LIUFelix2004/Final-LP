import { useState } from 'react';
import type { GmgnSettings } from '../services/gmgn';

interface Props {
  settings: GmgnSettings;
  onUpdate: (next: GmgnSettings) => void;
}

export function GmgnSettingsPanel({ settings, onUpdate }: Props) {
  const [open, setOpen] = useState(false);

  const patch = (p: Partial<GmgnSettings>) => onUpdate({ ...settings, ...p });

  if (!open) {
    return (
      <button className="alert-toggle-btn" onClick={() => setOpen(true)} title="GMGN 过滤设置">
        {'⚙'}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div className="alert-settings-panel">
        <div className="alert-settings-header">
          <strong>GMGN 过滤</strong>
          <button className="toast-close" onClick={() => setOpen(false)}>×</button>
        </div>

        <label className="alert-row">
          <input
            type="checkbox"
            checked={settings.hideMajorBases}
            onChange={(e) => patch({ hideMajorBases: e.target.checked })}
          />
          隐藏纯主流对 (WBNB/USDT…)
        </label>

        <div className="alert-field">
          <label>最低聪明钱买入数</label>
          <input
            type="number"
            value={settings.minSmartBuyCount}
            min={0}
            onChange={(e) => patch({ minSmartBuyCount: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="alert-field">
          <label>最低买入额 ($)</label>
          <input
            type="number"
            value={settings.minSmartBuyUsd}
            min={0}
            onChange={(e) => patch({ minSmartBuyUsd: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="alert-field">
          <label>最大代币年龄 (h, 0=关)</label>
          <input
            type="number"
            value={settings.maxAgeHours}
            min={0}
            onChange={(e) => patch({ maxAgeHours: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="alert-field">
          <label>DexScreener 扇出</label>
          <input
            type="number"
            value={settings.dexFanout}
            min={5}
            max={50}
            onChange={(e) => patch({ dexFanout: Math.max(5, Math.min(50, Number(e.target.value) || 40)) })}
          />
        </div>

        <label className="alert-row" title="GMGN API 暂无 KOL 过滤标志；留作占位">
          <input
            type="checkbox"
            checked={settings.includeKol}
            onChange={(e) => patch({ includeKol: e.target.checked })}
            disabled
          />
          包含 KOL 买入 (暂不支持)
        </label>
      </div>
    </div>
  );
}
