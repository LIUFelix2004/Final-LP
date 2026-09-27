import type { StockFeeRow, PerpQuote, FairPriceResult, FundingBucket, StockSignal } from '../../types/stocks';
import { FairPriceTable } from './FairPriceTable';
import { FundingTable } from './FundingTable';
import { StockSignals } from './StockSignals';
import { KlineChart } from './KlineChart';
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

function premiumBadge(premium: number | null): { text: string; cls: string } | null {
  if (premium === null || !Number.isFinite(premium)) return null;
  const pct = formatSignedPercent(premium);
  if (Math.abs(premium) <= 0.005) return { text: `链上溢价 ${pct} · 在 ±0.5% 内`, cls: 'badge-ok' };
  if (premium > 0) return { text: `链上溢价 ${pct} · 链上买入不划算`, cls: 'badge-warn' };
  return { text: `链上折价 ${pct} · 链上买入划算`, cls: 'badge-good' };
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
  klineData,
}: Props) {
  const session = getUsMarketSession();
  const badge = premiumBadge(premium);

  return (
    <div className="stock-detail">
      <div className="stock-detail-header">
        <h2>
          {row.symbol} <span className="stock-detail-name">{row.name}</span>
          <span className="stock-detail-tag">股票代币</span>
        </h2>
        <div className="stock-detail-meta">
          <span className="market-session" data-state={session.state}>
            {session.label}
          </span>
          <span className="market-et-time">ET {session.etTime}</span>
          {badge && <span className={`premium-badge ${badge.cls}`}>{badge.text}</span>}
        </div>
      </div>

      <div className="stock-detail-prices">
        <div className="price-card">
          <span className="price-label">链上主池价</span>
          <span className="price-value">{formatStockPrice(row.onchainPrice)}</span>
          {row.mainPool && (
            <span className="price-sub">
              {row.mainPool.dex} · {row.mainPool.version}
              {row.mainPool.feeRateInferred && ' (推断)'}
            </span>
          )}
        </div>
        <div className="price-card">
          <span className="price-label">公允价（{fairResult?.participatingExchanges.length ?? 0} 所中位）</span>
          <span className="price-value">{formatStockPrice(fairResult?.fair ?? null)}</span>
          {fairResult && fairResult.excludedExchanges.length > 0 && (
            <span className="price-sub">
              排除 {fairResult.excludedExchanges.length} 所
            </span>
          )}
        </div>
        <div className={`price-card premium ${premium !== null && Math.abs(premium) > 0.005 ? 'warn' : ''}`}>
          <span className="price-label">链上溢价</span>
          <span className="price-value">{formatSignedPercent(premium)}</span>
        </div>
      </div>

      {klineData && (
        <div className="stock-detail-section">
          <h3>公允价 K 线</h3>
          <KlineChart data={klineData} source={`Binance ${row.symbol}USDT`} />
        </div>
      )}

      <div className="stock-detail-section">
        <h3>Fair Price 明细</h3>
        {perpLoading && quotes.length === 0 ? (
          <div className="detail-loading">加载 CEX 数据...</div>
        ) : (
          <FairPriceTable
            quotes={quotes}
            onchainPrice={row.onchainPrice}
            mainPool={row.mainPool}
            fairResult={fairResult}
          />
        )}
      </div>

      <div className="stock-detail-section">
        <h3>Funding Rate</h3>
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
