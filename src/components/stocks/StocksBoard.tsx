import { useState } from 'react';
import type { StockFeeRow } from '../../types/stocks';
import { useStocksBoard } from '../../hooks/useStocksBoard';
import { useStockDetail } from '../../hooks/useStockDetail';
import { StockTopBar } from './StockTopBar';
import { StockFeeList } from './StockFeeList';
import { StockDetailPanel } from './StockDetailPanel';
import { RegisterToken } from './RegisterToken';
import './stocks.css';

interface Props {
  onBack: () => void;
}

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

  const [selectedRow, setSelectedRow] = useState<StockFeeRow | null>(null);

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
            selectedSymbol={selectedRow?.symbol ?? null}
            onSelect={setSelectedRow}
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
              <p>选择左侧股票查看详情</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
