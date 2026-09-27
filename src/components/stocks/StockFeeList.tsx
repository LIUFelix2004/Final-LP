import type { StockFeeRow, StockSortWindow } from '../../types/stocks';
import { formatSignedPercent } from '../../utils/format';

interface Props {
  rows: StockFeeRow[];
  loading: boolean;
  sortWindow: StockSortWindow;
  selectedSymbol: string | null;
  onSelect: (row: StockFeeRow) => void;
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

export function StockFeeList({ rows, loading, sortWindow, selectedSymbol, onSelect }: Props) {
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
        <span className="col-symbol">股票</span>
        <span className="col-price">链上价</span>
        <span className="col-fee">手续费</span>
        <span className="col-vol">24H量</span>
        <span className="col-liq">流动性</span>
      </div>
      {rows.map((row, i) => {
        const feeVal = getFeeValue(row, sortWindow);
        const isSelected = row.symbol === selectedSymbol;
        return (
          <div
            key={row.address}
            className={`stocks-list-row ${isSelected ? 'selected' : ''} ${i % 2 === 0 ? 'even' : 'odd'}`}
            onClick={() => onSelect(row)}
          >
            <span className="col-rank">{i + 1}</span>
            <span className="col-symbol">
              <span className="stock-sym">{row.symbol}</span>
              <span className="stock-name">{row.name}</span>
            </span>
            <span className="col-price">
              {row.onchainPrice !== null ? `$${row.onchainPrice.toFixed(2)}` : '—'}
            </span>
            <span className={`col-fee ${feeVal !== null && feeVal > 0 ? 'positive' : ''}`}>
              {feeVal !== null ? formatSignedPercent(feeVal) : '—'}
            </span>
            <span className="col-vol">
              {row.mainPool?.volume.h24 != null ? `$${(row.mainPool.volume.h24 / 1000).toFixed(0)}K` : '—'}
            </span>
            <span className="col-liq">
              {row.mainPool?.liquidityUsd != null ? `$${(row.mainPool.liquidityUsd / 1000).toFixed(0)}K` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
