import type { PerpQuote, FundingBucket } from '../../types/stocks';
import { EXCHANGE_META } from '../../config/stocks';
import { funding8hEquivalent, annualizeFunding } from '../../services/stocks/fairPrice';
import { formatSignedPercent } from '../../utils/format';

interface Props {
  quotes: PerpQuote[];
  buckets: FundingBucket[];
}

export function FundingTable({ quotes, buckets }: Props) {
  if (quotes.length === 0) {
    return <div className="detail-empty">暂无资金费率数据</div>;
  }

  const validQuotes = quotes.filter(q => q.fundingRate !== null && Number.isFinite(q.fundingRate));
  const bestShortIdx = validQuotes.length > 0
    ? validQuotes.reduce((best, q, i) => annualizeFunding(q.fundingRate!, q.fundingIntervalHours) > annualizeFunding(validQuotes[best].fundingRate!, validQuotes[best].fundingIntervalHours) ? i : best, 0)
    : -1;
  const bestLongIdx = validQuotes.length > 0
    ? validQuotes.reduce((best, q, i) => annualizeFunding(q.fundingRate!, q.fundingIntervalHours) < annualizeFunding(validQuotes[best].fundingRate!, validQuotes[best].fundingIntervalHours) ? i : best, 0)
    : -1;

  return (
    <div className="funding-table-wrap">
      <div className="funding-current">
        <div className="ft-header">
          <span className="ft-col-ex">交易所</span>
          <span className="ft-col-contract">合约</span>
          <span className="ft-col-rate">当前费率</span>
          <span className="ft-col-8h">8H 等价</span>
          <span className="ft-col-ann">年化</span>
          <span className="ft-col-int">间隔</span>
        </div>
        {quotes.map((q) => {
          const meta = EXCHANGE_META[q.exchange] ?? { name: q.exchange, color: '#888' };
          const hasRate = q.fundingRate !== null && Number.isFinite(q.fundingRate);
          const eq8h = hasRate ? funding8hEquivalent(q.fundingRate!, q.fundingIntervalHours) : null;
          const ann = hasRate ? annualizeFunding(q.fundingRate!, q.fundingIntervalHours) : null;
          const validIdx = validQuotes.indexOf(q);
          const isBestShort = validIdx === bestShortIdx;
          const isBestLong = validIdx === bestLongIdx;
          return (
            <div key={q.exchange} className={`ft-row ${isBestShort ? 'best-short' : ''} ${isBestLong ? 'best-long' : ''}`}>
              <span className="ft-col-ex">
                <span className="ex-dot" style={{ background: meta.color }} />
                {meta.name}
                {isBestShort && <span className="ft-tag short">空优</span>}
                {isBestLong && <span className="ft-tag long">多优</span>}
              </span>
              <span className="ft-col-contract" title={q.contract}>{q.contract}</span>
              <span className="ft-col-rate">{formatSignedPercent(q.fundingRate, 4)}</span>
              <span className="ft-col-8h">{eq8h !== null ? formatSignedPercent(eq8h, 4) : '—'}</span>
              <span className={`ft-col-ann ${ann !== null && ann > 0 ? 'positive' : ann !== null && ann < 0 ? 'negative' : ''}`}>
                {ann !== null ? formatSignedPercent(ann) : '—'}
              </span>
              <span className="ft-col-int">{q.fundingIntervalHours}h</span>
            </div>
          );
        })}
      </div>

      {buckets.length > 0 && (
        <div className="funding-history">
          <h4>历史 8H 资金费率（UTC 对齐）</h4>
          <div className="fb-header">
            <span className="fb-col-time">时段</span>
            {buckets[0] && Object.keys(buckets[0].rates).map(ex => (
              <span key={ex} className="fb-col-rate">{EXCHANGE_META[ex]?.name ?? ex}</span>
            ))}
          </div>
          {buckets.map((bucket, i) => (
            <div key={i} className="fb-row">
              <span className="fb-col-time">{bucket.label}</span>
              {Object.entries(bucket.rates).map(([ex, val]) => (
                <span key={ex} className={`fb-col-rate ${val !== null && val > 0 ? 'positive' : val !== null && val < 0 ? 'negative' : ''}`}>
                  {val !== null ? formatSignedPercent(val, 4) : '—'}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
