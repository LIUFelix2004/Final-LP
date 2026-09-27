import { useState, useMemo, useEffect } from 'react';
import type { StockFeeRow } from '../../types/stocks';
import { useStocksBoard } from '../../hooks/useStocksBoard';
import { useStockDetail } from '../../hooks/useStockDetail';
import { getSamplerStats } from '../../services/stocks/feeSampler';
import { StockTopBar } from './StockTopBar';
import { StockFeeList } from './StockFeeList';
import { StockDetailPanel } from './StockDetailPanel';
import { RegisterToken } from './RegisterToken';
import './stocks.css';

interface Props {
  onBack: () => void;
}

const DEFAULT_SYMBOL = 'HIMS';

export function StocksBoard({ onBack }: Props) {
  const {
    rows,
    loading,
    discovering,
    discoveryProgress,
    errors,
    lastUpdate,
    sortWindow,
    setSortWindow,
    autoRefresh,
    setAutoRefresh,
    refresh,
  } = useStocksBoard();

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(() => {
    try { return localStorage.getItem('stocks-selected-symbol') ?? DEFAULT_SYMBOL; } catch { return DEFAULT_SYMBOL; }
  });

  useEffect(() => {
    try {
      if (selectedSymbol) localStorage.setItem('stocks-selected-symbol', selectedSymbol);
    } catch {}
  }, [selectedSymbol]);

  const selectedRow: StockFeeRow | null = useMemo(() => {
    if (!selectedSymbol) return null;
    return rows.find(r => r.symbol === selectedSymbol) ?? null;
  }, [selectedSymbol, rows]);

  const {
    quotes,
    fairResult,
    premium,
    signals,
    fundingBuckets,
    perpErrors,
    perpLoading,
    klineData,
  } = useStockDetail(selectedRow, autoRefresh);

  const handleSelect = (row: StockFeeRow) => {
    setSelectedSymbol(row.symbol);
  };

  return (
    <div className="stocks-board">
      <StockTopBar
        onBack={onBack}
        lastUpdate={lastUpdate}
        loading={loading}
        discovering={discovering}
        discoveryProgress={discoveryProgress}
        sortWindow={sortWindow}
        onSortWindowChange={setSortWindow}
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
        onRefresh={refresh}
        errors={errors}
        rowCount={rows.length}
      />
      <div className="stocks-panels">
        <div className="stocks-left">
          <div className="stocks-left-actions">
            <RegisterToken onRegistered={() => refresh()} />
          </div>
          <StockFeeList
            rows={rows}
            loading={loading}
            sortWindow={sortWindow}
            selectedSymbol={selectedSymbol}
            onSelect={handleSelect}
          />
        </div>
        <div className="stocks-right">
          {selectedRow ? (
            <StockDetailPanel
              row={selectedRow}
              quotes={quotes}
              fairResult={fairResult}
              premium={premium}
              signals={signals}
              fundingBuckets={fundingBuckets}
              perpErrors={perpErrors}
              perpLoading={perpLoading}
              klineData={klineData}
            />
          ) : (
            <div className="stocks-placeholder">
              <p>{selectedSymbol ? `${selectedSymbol} 暂无数据，等待发现...` : '选择左侧股票查看详情'}</p>
            </div>
          )}
        </div>
      </div>
      <StocksFooter />
    </div>
  );
}

function StocksFooter() {
  const stats = getSamplerStats();
  const totalSamples = stats.fastCount + stats.slowCount;

  const nextSample = (): string => {
    const now = Date.now();
    const nextFast = stats.lastFastTime + 5 * 60 * 1000;
    const target = Math.max(nextFast, now);
    const d = new Date(target);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="stocks-footer">
      下次采样 {nextSample()} · 已采 {totalSamples} 次
    </div>
  );
}
