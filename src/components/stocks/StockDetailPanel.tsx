import type { StockFeeRow, PerpQuote, FairPriceResult, FundingBucket, StockSignal } from '../../types/stocks';
import { FairPriceTable } from './FairPriceTable';
import { FundingTable } from './FundingTable';
import { StockSignals } from './StockSignals';
import { getUsMarketSession } from '../../services/stocks/marketSession';
import { formatSignedPercent, formatStockPrice } from '../../utils/format';

interface Props {
  row: StockFeeRow;
  quotes: PerpQuote[];
  fairResult: FairPriceResult | null;
  premium: number | null;
  signals: StockSignal[];
  fundingBuckets: FundingBucket[];
  perpErrors: string[];
  perpLoading: boolean;
  klineData: number[][] | null;
}

export function StockDetailPanel({
  row,
  quotes,
  fairResult,
  premium,
  signals,
  fundingBuckets,
  perpErrors,
  perpLoading,
}: Props) {
  const session = getUsMarketSession();

  return (
    <div className="stock-detail">
      <div className="stock-detail-header">
        <h2>{row.symbol} <span className="stock-detail-name">{row.name}</span></h2>
        <div className="stock-detail-meta">
          <span className="market-session" data-state={session.state}>
            {session.label}
          </span>
          {session.reason && <span className="market-reason">{session.reason}</span>}
        </div>
      </div>

      <div className="stock-detail-prices">
        <div className="price-card">
          <span className="price-label">链上价格</span>
          <span className="price-value">{formatStockPrice(row.onchainPrice)}</span>
          {row.mainPool && (
            <span className="price-sub">
              {row.mainPool.dex} · {row.mainPool.version}
              {row.mainPool.feeRateInferred && ' (推断)'}
            </span>
          )}
        </div>
        <div className="price-card">
          <span className="price-label">Fair Price</span>
          <span className="price-value">{formatStockPrice(fairResult?.fair ?? null)}</span>
          {fairResult && (
            <span className="price-sub">
              {fairResult.participatingExchanges.length} 交易所
            </span>
          )}
        </div>
        <div className={`price-card premium ${premium !== null && Math.abs(premium) > 0.005 ? 'warn' : ''}`}>
          <span className="price-label">溢价</span>
          <span className="price-value">{formatSignedPercent(premium)}</span>
        </div>
      </div>

      <div className="stock-detail-section">
        <h3>Fair Price 明细</h3>
        {perpLoading && quotes.length === 0 ? (
          <div className="detail-loading">加载 CEX 数据...</div>
        ) : (
          <FairPriceTable
            quotes={quotes}
            onchainPrice={row.onchainPrice}
            mainPool={row.mainPool}
          />
        )}
      </div>

      <div className="stock-detail-section">
        <h3>Funding Rate (8H 等价)</h3>
        <FundingTable
          quotes={quotes}
          buckets={fundingBuckets}
        />
      </div>

      <div className="stock-detail-section">
        <h3>信号</h3>
        <StockSignals signals={signals} />
      </div>

      {perpErrors.length > 0 && (
        <div className="stock-detail-errors">
          {perpErrors.map((e, i) => <div key={i} className="perp-error">{e}</div>)}
        </div>
      )}

      <div className="stock-detail-pools">
        <h3>链上池 ({row.pools.length})</h3>
        <div className="pool-list-mini">
          {row.pools.map(pool => (
            <div key={pool.pairAddress} className="pool-mini-row">
              <span className="pool-mini-dex">{pool.dex}</span>
              <span className="pool-mini-ver">{pool.version}</span>
              <span className="pool-mini-fee">
                {pool.feeRate !== null ? `${(pool.feeRate).toFixed(2)}%` : '?'}
                {pool.feeRateInferred && '*'}
              </span>
              <span className="pool-mini-liq">
                ${((pool.liquidityUsd ?? 0) / 1000).toFixed(0)}K
              </span>
              <span className="pool-mini-vol">
                ${((pool.volume.h24 ?? 0) / 1000).toFixed(0)}K
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
