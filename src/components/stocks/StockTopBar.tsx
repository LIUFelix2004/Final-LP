import type { StockFeeRow, StockSortWindow } from '../../types/stocks';
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
  rows: StockFeeRow[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  amountUsdg: number;
  onAmountChange: (v: number) => void;
}

const ALL_WINDOWS: StockSortWindow[] = ['m5', 'h1', 'h24', 'm30', 'h48', 'h72', 'd7'];

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
  rows,
  selectedSymbol,
  onSelectSymbol,
  amountUsdg,
  onAmountChange,
}: Props) {
  const sortedByH24 = [...rows].sort((a, b) => (b.fee.h24 ?? -1) - (a.fee.h24 ?? -1));
  return (
    <div className="stocks-topbar">
      <div className="stocks-topbar-left">
        <button className="stocks-back-btn" onClick={onBack} title="返回 LP 榜单">
          LP 榜单
        </button>
        <span className="stocks-title">
          热门股票 · USDG 池手续费 {rowCount > 0 ? `${rowCount} 只` : ''}
        </span>
        {sortedByH24.length > 0 && (
          <select
            className="stocks-code-dropdown"
            value={selectedSymbol ?? ''}
            onChange={e => onSelectSymbol(e.target.value)}
          >
            {sortedByH24.map(r => (
              <option key={r.address} value={r.symbol}>{r.symbol}</option>
            ))}
          </select>
        )}
        {lastUpdate && (
          <span className="stocks-refresh-time">行情 {formatTime(lastUpdate)}</span>
        )}
        <input
          type="number"
          className="stocks-amount-input"
          value={amountUsdg}
          onChange={e => onAmountChange(Math.max(0, Number(e.target.value) || 0))}
          title="模拟金额 (USDG)"
          min={0}
          step={100}
        />
        <span className="stocks-amount-label">USDG</span>
        <select
          className="stocks-sort-select"
          value={sortWindow}
          onChange={e => onSortWindowChange(e.target.value as StockSortWindow)}
        >
          {ALL_WINDOWS.map(w => (
            <option key={w} value={w}>{STOCK_SORT_LABELS[w]}</option>
          ))}
        </select>
        {discovering && (
          <span className="stocks-discovering">
            发现池 {discoveryProgress.current}/{discoveryProgress.total}
          </span>
        )}
      </div>
      <div className="stocks-topbar-right">
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
