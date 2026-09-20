import { useState } from 'react';
import { ChainSwitcher } from './components/ChainSwitcher';
import { Header } from './components/Header';
import { PoolTable } from './components/PoolTable';
import { TimeframeSwitcher } from './components/TimeframeSwitcher';
import { usePoolData } from './hooks/usePoolData';
import { DEFAULT_CHAIN_ID } from './config/chains';
import './App.css';

function App() {
  const [chainId, setChainId] = useState(DEFAULT_CHAIN_ID);
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
  } = usePoolData(chainId);

  return (
    <div className="app">
      <Header
        lastUpdate={lastUpdate}
        poolCount={pools.length}
        loading={loading}
        onRefresh={refresh}
        minTvl={minTvl}
        onMinTvlChange={setMinTvl}
      />
      <div className="controls-row">
        <ChainSwitcher activeChainId={chainId} onSwitch={setChainId} />
        <TimeframeSwitcher active={timeWindow} onChange={setTimeWindow} />
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
          <PoolTable
            pools={pools}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            chainId={chainId}
            isEmpty={isEmpty}
            hasError={!!error}
            timeWindow={timeWindow}
          />
        </>
      )}
    </div>
  );
}

export default App;
