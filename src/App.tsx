import { useState, useCallback, useEffect } from 'react';
import type { PoolData, DiscoveryMode } from './types';
import { ChainSwitcher } from './components/ChainSwitcher';
import { DiscoveryToggle } from './components/DiscoveryToggle';
import { GmgnSettingsPanel } from './components/GmgnSettingsPanel';
import { Header } from './components/Header';
import { PoolTable } from './components/PoolTable';
import { TimeframeSwitcher } from './components/TimeframeSwitcher';
import { WatchlistControls } from './components/WatchlistControls';
import { AlertSettingsPanel } from './components/AlertSettingsPanel';
import { ToastContainer } from './components/ToastContainer';
import { usePoolData } from './hooks/usePoolData';
import { useWatchlist } from './hooks/useWatchlist';
import { useAlerts } from './hooks/useAlerts';
import { isGmgnConfigured, loadGmgnSettings, saveGmgnSettings } from './services/gmgn';
import type { GmgnSettings } from './services/gmgn';
import { DEFAULT_CHAIN_ID } from './config/chains';
import './App.css';

function App() {
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>('major');
  const [gmgnSettings, setGmgnSettings] = useState<GmgnSettings>(loadGmgnSettings);

  const gmgnAvailable = isGmgnConfigured();

  const handleGmgnSettingsUpdate = useCallback((next: GmgnSettings) => {
    setGmgnSettings(next);
    saveGmgnSettings(next);
  }, []);

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
    clearToasts,
  } = useAlerts();

  useEffect(() => {
    clearToasts();
  }, [chainId, discoveryMode, clearToasts]);

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
  } = usePoolData(chainId, onRefreshComplete, discoveryMode, gmgnSettings);

  const filteredPools = watchlistOnly
    ? pools.filter((p) => watchlistedAddrs.has(p.pairAddress.toLowerCase()))
    : pools;

  const handleDiscoveryChange = useCallback((mode: DiscoveryMode) => {
    if (mode === 'gmgn' && !gmgnAvailable) return;
    setDiscoveryMode(mode);
  }, [gmgnAvailable]);

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
        <DiscoveryToggle
          mode={discoveryMode}
          onChange={handleDiscoveryChange}
          gmgnAvailable={gmgnAvailable}
        />
        {discoveryMode === 'gmgn' && (
          <GmgnSettingsPanel settings={gmgnSettings} onUpdate={handleGmgnSettingsUpdate} />
        )}
        <TimeframeSwitcher active={timeWindow} onChange={setTimeWindow} />
        <WatchlistControls
          watchlistOnly={watchlistOnly}
          onToggleFilter={setWatchlistOnly}
          onAddPool={addPool}
          watchlistCount={watchlistCount}
        />
        <AlertSettingsPanel settings={alertSettings} onUpdate={updateAlertSettings} />
      </div>

      {discoveryMode === 'gmgn' && !gmgnAvailable && (
        <div className="warning-bar">
          <span>GMGN API key not configured. Add <code>GMGN_API_KEY=your_key</code> to <code>.env</code> and restart dev server.</span>
        </div>
      )}

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={refresh}>重试</button>
        </div>
      )}

      {warnings.length > 0 && !error && (
        <div className="warning-bar">
          <span>{warnings[0]}{warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ''}</span>
        </div>
      )}

      {loading && pools.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>{discoveryMode === 'gmgn' ? 'GMGN Smart Money loading...' : '正在加载数据...'}</p>
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
            discoveryMode={discoveryMode}
          />
        </>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
