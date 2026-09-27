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
    return <div className="detail-empty">暂无 Funding 数据</div>;
  }

  return (
    <div className="funding-table-wrap">
      <div className="funding-current">
        <div className="ft-header">
          <span className="ft-col-ex">交易所</span>
          <span className="ft-col-rate">当前 Rate</span>
          <span className="ft-col-8h">8H 等价</span>
          <span className="ft-col-ann">年化</span>
          <span className="ft-col-int">间隔</span>
        </div>
        {quotes.map(q => {
          const meta = EXCHANGE_META[q.exchange] ?? { name: q.exchange, color: '#888' };
          const eq8h = funding8hEquivalent(q.fundingRate, q.fundingIntervalHours);
          const ann = annualizeFunding(q.fundingRate, q.fundingIntervalHours);
          return (
            <div key={q.exchange} className="ft-row">
              <span className="ft-col-ex">
                <span className="ex-dot" style={{ background: meta.color }} />
                {meta.name}
              </span>
              <span className="ft-col-rate">{formatSignedPercent(q.fundingRate, 4)}</span>
              <span className="ft-col-8h">{formatSignedPercent(eq8h, 4)}</span>
              <span className={`ft-col-ann ${ann > 0 ? 'positive' : ann < 0 ? 'negative' : ''}`}>
                {formatSignedPercent(ann)}
              </span>
              <span className="ft-col-int">{q.fundingIntervalHours}h</span>
            </div>
          );
        })}
      </div>

      {buckets.length > 0 && (
        <div className="funding-history">
          <h4>历史 8H Buckets</h4>
          <div className="fb-header">
            <span className="fb-col-time">时段</span>
            {buckets[0] && Object.keys(buckets[0].rates).map(ex => (
              <span key={ex} className="fb-col-rate">{EXCHANGE_META[ex]?.name ?? ex}</span>
            ))}
          </div>
          {buckets.map((bucket, i) => {
            const start = new Date(bucket.startTime);
            const label = `${start.getUTCMonth() + 1}/${start.getUTCDate()} ${String(start.getUTCHours()).padStart(2, '0')}:00`;
            return (
              <div key={i} className="fb-row">
                <span className="fb-col-time">{label}</span>
                {Object.entries(bucket.rates).map(([ex, val]) => (
                  <span key={ex} className={`fb-col-rate ${val !== null && val > 0 ? 'positive' : val !== null && val < 0 ? 'negative' : ''}`}>
                    {val !== null ? formatSignedPercent(val, 4) : '—'}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
