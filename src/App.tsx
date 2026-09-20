import { useState, useCallback } from 'react';
import type { PoolData } from './types';
import { ChainSwitcher } from './components/ChainSwitcher';
import { Header } from './components/Header';
import { PoolTable } from './components/PoolTable';
import { TimeframeSwitcher } from './components/TimeframeSwitcher';
import { WatchlistControls } from './components/WatchlistControls';
import { AlertSettingsPanel } from './components/AlertSettingsPanel';
import { ToastContainer } from './components/ToastContainer';
import { usePoolData } from './hooks/usePoolData';
import { useWatchlist } from './hooks/useWatchlist';
import { useAlerts } from './hooks/useAlerts';
import { DEFAULT_CHAIN_ID } from './config/chains';
import './App.css';

function App() {
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);

  const {
    entries: watchlistEntries,
    watchlistedAddrs,
    watchlistOnly,
    setWatchlistOnly,
    isWatchlisted,
    togglePool,
    addPool,
    count: watchlistCount,
  } = useWatchlist(chainId);

  const {
    settings: alertSettings,
    updateSettings: updateAlertSettings,
    checkSpikes,
    toasts,
    dismissToast,
  } = useAlerts();

  const onRefreshComplete = useCallback(
    (pools: PoolData[]) => {
      checkSpikes(pools, watchlistedAddrs);
    },
    [checkSpikes, watchlistedAddrs],
  );

  const {
    pools,
    loading,
    error,
    warnings,
    lastUpdate,
    sortField,
    sortDir,
    handleSort,
    minTvl,
    setMinTvl,
    timeWindow,
    setTimeWindow,
    refresh,
    totalCount,
    isEmpty,
  } = usePoolData(chainId, onRefreshComplete);

  const filteredPools = watchlistOnly
    ? pools.filter((p) => watchlistedAddrs.has(p.pairAddress.toLowerCase()))
    : pools;

  return (
    <div className="app">
      <Header
        lastUpdate={lastUpdate}
        poolCount={filteredPools.length}
        loading={loading}
        onRefresh={refresh}
        minTvl={minTvl}
        onMinTvlChange={setMinTvl}
      />
      <div className="controls-row">
        <ChainSwitcher activeChainId={chainId} onSwitch={setChainId} />
        <TimeframeSwitcher active={timeWindow} onChange={setTimeWindow} />
        <WatchlistControls
          watchlistOnly={watchlistOnly}
          onToggleFilter={setWatchlistOnly}
          onAddPool={addPool}
          watchlistCount={watchlistCount}
        />
        <AlertSettingsPanel settings={alertSettings} onUpdate={updateAlertSettings} />
      </div>

      {error && (
        <div className="error-bar">
          <span>⚠️ {error}</span>
          <button onClick={refresh}>重试</button>
        </div>
      )}

      {warnings.length > 0 && !error && (
        <div className="warning-bar">
          <span>⚠️ {warnings[0]}{warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}</span>
        </div>
      )}

      {loading && pools.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>正在加载数据...</p>
        </div>
      ) : (
        <>
          {totalCount > 0 && minTvl > 0 && pools.length < totalCount && (
            <div className="filter-note">
              已过滤 {totalCount - pools.length} 个低TVL池
            </div>
          )}
          {watchlistOnly && watchlistEntries.length > 0 && (
            <div className="filter-note">
              自选模式: 显示 {filteredPools.length}/{watchlistEntries.length} 个自选池
              {filteredPools.length < watchlistEntries.length && ' (部分池暂无数据)'}
            </div>
          )}
          <PoolTable
            pools={filteredPools}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            chainId={chainId}
            isEmpty={isEmpty && !watchlistOnly}
            hasError={!!error}
            timeWindow={timeWindow}
            isWatchlisted={isWatchlisted}
            onToggleWatchlist={togglePool}
          />
        </>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
