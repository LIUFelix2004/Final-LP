import type { StockFeeRow, StockSortWindow } from '../../types/stocks';
import { STOCK_SORT_LABELS } from '../../config/stocks';
import { getM30SampleCount } from '../../services/stocks/feeSampler';

interface Props {
  rows: StockFeeRow[];
  loading: boolean;
  sortWindow: StockSortWindow;
  selectedSymbol: string | null;
  onSelect: (row: StockFeeRow) => void;
  onRemove?: (row: StockFeeRow) => void;
  userAddedSymbols?: Set<string>;
}

function getFeeValue(row: StockFeeRow, window: StockSortWindow): number | null {
  switch (window) {
    case 'm5': return row.fee.m5;
    case 'h1': return row.fee.h1;
    case 'h24': return row.fee.h24;
    case 'm30': return row.sampled?.m30 ?? null;
    case 'h48': return row.sampled?.h48 ?? null;
    case 'h72': return row.sampled?.h72 ?? null;
    case 'd7': return row.sampled?.d7 ?? null;
    default: return row.fee.h24;
  }
}

const ALL_WINDOWS: StockSortWindow[] = ['m5', 'm30', 'h1', 'h24', 'h48', 'h72', 'd7'];

function formatFeeUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function StockFeeList({ rows, loading, sortWindow, selectedSymbol, onSelect, onRemove, userAddedSymbols }: Props) {
  if (loading && rows.length === 0) {
    return (
      <div className="stocks-list-loading">
        <div className="spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return <div className="stocks-list-empty">暂无数据</div>;
  }

  return (
    <div className="stocks-fee-list">
      <div className="stocks-list-header">
        <span className="col-rank">#</span>
        <span className="col-symbol">代码</span>
        {ALL_WINDOWS.map(w => (
          <span key={w} className={`col-fee-cell ${w === sortWindow ? 'active-col' : ''}`}>
            {STOCK_SORT_LABELS[w]}
          </span>
        ))}
      </div>
      {rows.map((row, i) => {
        const isSelected = row.symbol === selectedSymbol;
        return (
          <div
            key={row.address}
            className={`stocks-list-row ${isSelected ? 'selected' : ''} ${i % 2 === 0 ? 'even' : 'odd'}`}
            onClick={() => onSelect(row)}
          >
            <span className="col-rank">{i + 1}</span>
            <span className="col-symbol">
              <span className="stock-sym">
                {row.symbol}
                {onRemove && userAddedSymbols?.has(row.symbol) && (
                  <button
                    className="stock-remove-btn"
                    onClick={e => { e.stopPropagation(); onRemove(row); }}
                    title={`移除 ${row.symbol}`}
                  >&times;</button>
                )}
              </span>
              <span className="stock-name">{row.name}</span>
            </span>
            {ALL_WINDOWS.map(w => {
              const val = getFeeValue(row, w);
              const isSampled = w === 'm30' || w === 'h48' || w === 'h72' || w === 'd7';
              let tooltip = '';
              if (isSampled && val === null) {
                tooltip = '需要浏览器持续打开采样';
              } else if (w === 'm30' && val !== null) {
                const k = getM30SampleCount(row.symbol);
                tooltip = `采样 ${k}/6${k < 6 ? '（已外推）' : ''}`;
              }
              if (row.feeUnknownCount > 0 && !isSampled) {
                const volStr = row.feeUnknownVolume24h >= 1000
                  ? `$${(row.feeUnknownVolume24h / 1000).toFixed(0)}K`
                  : `$${row.feeUnknownVolume24h.toFixed(0)}`;
                tooltip = `${row.feeUnknownCount} 个池费率未知，${volStr} 未计入` + (tooltip ? `；${tooltip}` : '');
              }
              return (
                <span
                  key={w}
                  className={`col-fee-cell ${val !== null && val > 0 ? 'positive' : ''} ${w === sortWindow ? 'active-col' : ''}`}
                  title={tooltip || undefined}
                >
                  {formatFeeUsd(val)}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
