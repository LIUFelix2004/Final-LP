import type { PerpQuote, StockPool } from '../../types/stocks';
import { EXCHANGE_META } from '../../config/stocks';
import { formatStockPrice, formatSignedPercent } from '../../utils/format';

interface Props {
  quotes: PerpQuote[];
  onchainPrice: number | null;
  mainPool: StockPool | null;
}

export function FairPriceTable({ quotes, onchainPrice, mainPool }: Props) {
  if (quotes.length === 0 && !mainPool) {
    return <div className="detail-empty">暂无报价</div>;
  }

  return (
    <div className="fair-price-table">
      <div className="fpt-header">
        <span className="fpt-col-ex">交易所</span>
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
          <span className="fpt-col-mark">{formatStockPrice(onchainPrice)}</span>
          <span className="fpt-col-index">—</span>
          <span className="fpt-col-vol">
            {mainPool.volume.h24 !== null ? `$${(mainPool.volume.h24 / 1000).toFixed(0)}K` : '—'}
          </span>
          <span className="fpt-col-prem">—</span>
        </div>
      )}
      {quotes.map(q => {
        const meta = EXCHANGE_META[q.exchange] ?? { name: q.exchange, color: '#888' };
        return (
          <div key={q.exchange} className="fpt-row">
            <span className="fpt-col-ex">
              <span className="ex-dot" style={{ background: meta.color }} />
              {meta.name}
            </span>
            <span className="fpt-col-mark">{formatStockPrice(q.markPrice)}</span>
            <span className="fpt-col-index">{formatStockPrice(q.indexPrice)}</span>
            <span className="fpt-col-vol">
              {q.volume24h > 0 ? `$${(q.volume24h / 1000).toFixed(0)}K` : '—'}
            </span>
            <span className="fpt-col-prem">
              {onchainPrice && q.markPrice
                ? formatSignedPercent(onchainPrice / q.markPrice - 1)
                : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
