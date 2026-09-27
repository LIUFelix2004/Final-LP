import type { PerpQuote, StockPool, FairPriceResult } from '../../types/stocks';
import { EXCHANGE_META, MIN_PERP_VOLUME_USD } from '../../config/stocks';
import { formatStockPrice, formatSignedPercent } from '../../utils/format';

interface Props {
  quotes: PerpQuote[];
  onchainPrice: number | null;
  mainPool: StockPool | null;
  fairResult?: FairPriceResult | null;
}

export function FairPriceTable({ quotes, onchainPrice, mainPool, fairResult }: Props) {
  if (quotes.length === 0 && !mainPool) {
    return <div className="detail-empty">暂无报价</div>;
  }

  const fairPrice = fairResult?.fair ?? null;

  return (
    <div className="fair-price-table">
      <div className="fpt-header">
        <span className="fpt-col-ex">交易所</span>
        <span className="fpt-col-contract">合约</span>
        <span className="fpt-col-last">最新价</span>
        <span className="fpt-col-mark">Mark</span>
        <span className="fpt-col-index">Index</span>
        <span className="fpt-col-vol">24H量</span>
        <span className="fpt-col-prem">vs Fair</span>
      </div>
      {mainPool && (
        <div className="fpt-row onchain">
          <span className="fpt-col-ex">
            <span className="ex-dot" style={{ background: EXCHANGE_META.onchain?.color }} />
            链上主池
          </span>
          <span className="fpt-col-contract">{mainPool.dex} {mainPool.version}</span>
          <span className="fpt-col-last">—</span>
          <span className="fpt-col-mark">{formatStockPrice(onchainPrice)}</span>
          <span className="fpt-col-index">—</span>
          <span className="fpt-col-vol">
            {mainPool.volume.h24 !== null ? `$${(mainPool.volume.h24 / 1000).toFixed(0)}K` : '—'}
          </span>
          <span className="fpt-col-prem">
            {onchainPrice && fairPrice
              ? formatSignedPercent(onchainPrice / fairPrice - 1)
              : '—'}
          </span>
        </div>
      )}
      {quotes.map(q => {
        const meta = EXCHANGE_META[q.exchange] ?? { name: q.exchange, color: '#888' };
        const isLowVol = q.volume24h !== null && q.volume24h < MIN_PERP_VOLUME_USD;
        return (
          <div key={q.exchange} className={`fpt-row${isLowVol ? ' low-vol' : ''}`}>
            <span className="fpt-col-ex">
              <span className="ex-dot" style={{ background: meta.color }} />
              {meta.name}
            </span>
            <span className="fpt-col-contract">{q.contract || '—'}</span>
            <span className="fpt-col-last">{formatStockPrice(q.lastPrice)}</span>
            <span className="fpt-col-mark">{formatStockPrice(q.markPrice)}</span>
            <span className="fpt-col-index">{formatStockPrice(q.indexPrice)}</span>
            <span className="fpt-col-vol">
              {q.volume24h !== null && q.volume24h > 0 ? `$${(q.volume24h / 1000).toFixed(0)}K` : '—'}
            </span>
            <span className="fpt-col-prem">
              {fairPrice && q.markPrice
                ? formatSignedPercent(q.markPrice / fairPrice - 1)
                : '—'}
            </span>
          </div>
        );
      })}
      {quotes.some(q => q.volume24h !== null && q.volume24h < MIN_PERP_VOLUME_USD) && (
        <div className="fpt-footnote">灰色行: 24H 量 &lt; $50K，不参与公允价计算</div>
      )}
    </div>
  );
}
