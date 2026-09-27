import { useState, useMemo, useEffect } from 'react';
import type { StockFeeRow } from '../../types/stocks';
import { useStocksBoard } from '../../hooks/useStocksBoard';
import { useStockDetail } from '../../hooks/useStockDetail';
import { getSamplerStats } from '../../services/stocks/feeSampler';
import { StockTopBar } from './StockTopBar';
import { StockFeeList } from './StockFeeList';
import { StockDetailPanel } from './StockDetailPanel';
import { RegisterToken } from './RegisterToken';
import { AddSymbolInput } from './AddSymbolInput';
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
    addSymbol,
    removeSymbol,
    registry,
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
    perpStale,
    klineData,
    klineSource,
    amountUsdg,
    setAmountUsdg,
    amountAnalysis,
    amountLoading,
    lastPerpSuccess,
  } = useStockDetail(selectedRow, autoRefresh);

  const handleSelect = (row: StockFeeRow) => {
    setSelectedSymbol(row.symbol);
  };

  return (
    <div className="stocks-board">
      <StockTopBar
        onBack={onBack}
        lastUpdate={lastPerpSuccess ?? lastUpdate}
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
        rows={rows}
        selectedSymbol={selectedSymbol}
        onSelectSymbol={setSelectedSymbol}
        amountUsdg={amountUsdg}
        onAmountChange={setAmountUsdg}
      />
      {rows.length > 0 && (() => {
        const totalUnknown = rows.reduce((s, r) => s + r.feeUnknownCount, 0);
        if (totalUnknown === 0) return null;
        const totalVol = rows.reduce((s, r) => s + r.feeUnknownVolume24h, 0);
        const volStr = totalVol >= 1000 ? `$${(totalVol / 1000).toFixed(0)}K` : `$${totalVol.toFixed(0)}`;
        return (
          <div className="stocks-rpc-warn">
            {totalUnknown} 个池费率未知（含 V4 动态费 / RPC 未返回），{volStr} 24H 交易量未计入
          </div>
        );
      })()}
      <div className="stocks-panels">
        <div className="stocks-left">
          <div className="stocks-left-actions">
            <AddSymbolInput
              registry={registry}
              onAdded={(token) => { addSymbol(token.symbol); refresh(); }}
            />
            <RegisterToken onRegistered={() => refresh()} />
          </div>
          <StockFeeList
            rows={rows}
            loading={loading}
            sortWindow={sortWindow}
            selectedSymbol={selectedSymbol}
            onSelect={handleSelect}
            onRemove={(row) => removeSymbol(row.symbol, row.address)}
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
              perpStale={perpStale}
              klineData={klineData}
              klineSource={klineSource}
              amountAnalysis={amountAnalysis}
              amountLoading={amountLoading}
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const stats = getSamplerStats();
  const nextTime = new Date(Math.max(stats.nextSlowTime, now));
  const nextStr = `${String(nextTime.getHours()).padStart(2, '0')}:${String(nextTime.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="stocks-footer">
      下次采样 {nextStr} · 已采 {stats.slowMaxCount} 条/只
    </div>
  );
}
