import type { StockSortWindow } from '../../types/stocks';
import { STOCK_SORT_LABELS } from '../../config/stocks';

interface Props {
  onBack: () => void;
  lastUpdate: Date | null;
  loading: boolean;
  discovering: boolean;
  discoveryProgress: { current: number; total: number };
  sortWindow: StockSortWindow;
  onSortWindowChange: (w: StockSortWindow) => void;
  autoRefresh: boolean;
  onAutoRefreshToggle: () => void;
  onRefresh: () => void;
  errors: string[];
  rowCount: number;
}

const NATIVE_WINDOWS: StockSortWindow[] = ['m5', 'h1', 'h24'];
const SAMPLED_WINDOWS: StockSortWindow[] = ['m30', 'h48', 'h72', 'd7'];

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function StockTopBar({
  onBack,
  lastUpdate,
  loading,
  discovering,
  discoveryProgress,
  sortWindow,
  onSortWindowChange,
  autoRefresh,
  onAutoRefreshToggle,
  onRefresh,
  errors,
  rowCount,
}: Props) {
  return (
    <div className="stocks-topbar">
      <div className="stocks-topbar-left">
        <button className="stocks-back-btn" onClick={onBack} title="返回 LP 榜单">
          LP 榜单
        </button>
        <span className="stocks-title">
          热门股票 · USDG 池手续费 {rowCount > 0 ? `${rowCount} 只` : ''}
          {lastUpdate && ` · ${formatTime(lastUpdate)}`}
        </span>
        {discovering && (
          <span className="stocks-discovering">
            发现池 {discoveryProgress.current}/{discoveryProgress.total}
          </span>
        )}
      </div>
      <div className="stocks-topbar-right">
        <div className="stocks-sort-group">
          {NATIVE_WINDOWS.map(w => (
            <button
              key={w}
              className={`stocks-sort-btn ${sortWindow === w ? 'active' : ''}`}
              onClick={() => onSortWindowChange(w)}
            >
              {STOCK_SORT_LABELS[w]}
            </button>
          ))}
          <span className="stocks-sort-sep">|</span>
          {SAMPLED_WINDOWS.map(w => (
            <button
              key={w}
              className={`stocks-sort-btn sampled ${sortWindow === w ? 'active' : ''}`}
              onClick={() => onSortWindowChange(w)}
              title="需要采样数据"
            >
              {STOCK_SORT_LABELS[w]}
            </button>
          ))}
        </div>
        <label className="stocks-auto-toggle" title="自动刷新">
          <input type="checkbox" checked={autoRefresh} onChange={onAutoRefreshToggle} />
          自动刷新
        </label>
        <button
          className="stocks-refresh-btn"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? '...' : '刷新'}
        </button>
      </div>
      {errors.length > 0 && (
        <div className="stocks-error-bar">
          {errors[errors.length - 1]}
        </div>
      )}
    </div>
  );
}
