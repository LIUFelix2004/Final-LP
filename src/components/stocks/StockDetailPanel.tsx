import type { StockFeeRow, PerpQuote, FairPriceResult, FundingBucket, StockSignal } from '../../types/stocks';
import type { AmountAnalysis } from '../../services/stocks/quote';
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
  perpStale: boolean;
  klineData: unknown[] | null;
  klineSource: string | null;
  amountAnalysis: AmountAnalysis | null;
  amountLoading: boolean;
  amountProgress: string;
}

function summarizeReasons(reasons: string[]): string {
  const counts = new Map<string, number>();
  for (const r of reasons) {
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()].map(([r, c]) => c > 1 ? `${r} ×${c}` : r).join('、');
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
  perpStale,
  klineData,
  klineSource,
  amountAnalysis,
  amountLoading,
  amountProgress,
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
          {perpStale && <span className="perp-stale-badge">数据延迟</span>}
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

      <div className="stock-detail-section">
        <h3>公允价 K 线</h3>
        <KlineChart data={klineData} source={klineSource ?? undefined} />
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

      {(amountAnalysis || amountLoading) && (
        <div className="stock-detail-section">
          <h3>金额分析</h3>
          {amountLoading ? (
            <div className="detail-loading">{amountProgress || '模拟报价中...'}</div>
          ) : amountAnalysis ? (
            <div className="amount-analysis">
              {(amountAnalysis.buyStats?.mainPoolFailed || amountAnalysis.sellStats?.mainPoolFailed) && (
                <div className="amount-row amount-fail">主池报价失败，结果可能非最优</div>
              )}
              {amountAnalysis.buyResult && (
                <div className="amount-row">
                  <span className="amount-label">买入有效价</span>
                  <span className="amount-value">{formatStockPrice(amountAnalysis.buyResult.effectivePrice)}</span>
                  {amountAnalysis.buyPremium !== null && (
                    <span className={`amount-premium ${Math.abs(amountAnalysis.buyPremium) > 0.005 ? 'warn' : ''}`}>
                      较公允价 {formatSignedPercent(amountAnalysis.buyPremium)}
                    </span>
                  )}
                  <span className="amount-impact">
                    成交偏离（含手续费） {formatSignedPercent(amountAnalysis.buyResult.priceImpact)}
                  </span>
                  <span className="amount-pool">
                    {amountAnalysis.buyResult.quotedVia}
                    {row.mainPool && amountAnalysis.buyResult.pool.pairAddress !== row.mainPool.pairAddress && (
                      <span className="amount-pool-note">（非主池）{amountAnalysis.buyResult.pool.pairAddress.slice(0, 10)}</span>
                    )}
                  </span>
                </div>
              )}
              {amountAnalysis.buyStats && amountAnalysis.buyStats.failedCount > 0 && (
                <div className="amount-row amount-fail">
                  买入侧 {amountAnalysis.buyStats.failedCount}/{amountAnalysis.buyStats.quotedCount + amountAnalysis.buyStats.failedCount} 个池报价失败
                  {amountAnalysis.buyStats.failedReasons.length > 0 && (
                    <span className="fail-reasons">
                      （{summarizeReasons(amountAnalysis.buyStats.failedReasons)}）
                    </span>
                  )}
                </div>
              )}
              {amountAnalysis.sellResult && (
                <div className="amount-row">
                  <span className="amount-label">卖出有效价</span>
                  <span className="amount-value">{formatStockPrice(amountAnalysis.sellResult.effectivePrice)}</span>
                  {amountAnalysis.sellPremium !== null && (
                    <span className={`amount-premium ${Math.abs(amountAnalysis.sellPremium) > 0.005 ? 'warn' : ''}`}>
                      较公允价 {formatSignedPercent(amountAnalysis.sellPremium)}
                    </span>
                  )}
                  <span className="amount-impact">
                    成交偏离（含手续费） {formatSignedPercent(amountAnalysis.sellResult.priceImpact)}
                  </span>
                  <span className="amount-pool">
                    {amountAnalysis.sellResult.quotedVia}
                    {row.mainPool && amountAnalysis.sellResult.pool.pairAddress !== row.mainPool.pairAddress && (
                      <span className="amount-pool-note">（非主池）{amountAnalysis.sellResult.pool.pairAddress.slice(0, 10)}</span>
                    )}
                  </span>
                </div>
              )}
              {amountAnalysis.sellStats && amountAnalysis.sellStats.failedCount > 0 && (
                <div className="amount-row amount-fail">
                  卖出侧 {amountAnalysis.sellStats.failedCount}/{amountAnalysis.sellStats.quotedCount + amountAnalysis.sellStats.failedCount} 个池报价失败
                  {amountAnalysis.sellStats.failedReasons.length > 0 && (
                    <span className="fail-reasons">
                      （{summarizeReasons(amountAnalysis.sellStats.failedReasons)}）
                    </span>
                  )}
                </div>
              )}
              {amountAnalysis.buyResult && !amountAnalysis.sellResult && !amountAnalysis.sellStats?.failedCount && (
                <div className="amount-row amount-fail">
                  <span className="amount-label">卖出报价失败</span>
                </div>
              )}
              {!amountAnalysis.buyResult && amountAnalysis.sellResult && !amountAnalysis.buyStats?.failedCount && (
                <div className="amount-row amount-fail">
                  <span className="amount-label">买入报价失败</span>
                </div>
              )}
              {!amountAnalysis.buyResult && !amountAnalysis.sellResult && (
                <div className="detail-empty">无可报价的 Uniswap 池</div>
              )}
            </div>
          ) : null}
        </div>
      )}

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
