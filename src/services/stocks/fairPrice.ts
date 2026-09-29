import type { PerpQuote, FairPriceResult, FundingPoint, FundingBucket, StockSignal, MarketSession } from '../../types/stocks';
import type { AmountAnalysis } from './quote';
import { PREMIUM_THRESHOLD, MIN_PERP_VOLUME_USD, MIN_POOL_LIQUIDITY_WARN, EXCHANGE_META } from '../../config/stocks';

export function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  finite.sort((a, b) => a - b);
  const mid = Math.floor(finite.length / 2);
  if (finite.length % 2 === 1) return finite[mid];
  return (finite[mid - 1] + finite[mid]) / 2;
}

export function computeFairPrice(
  quotes: PerpQuote[],
  minVolume: number = MIN_PERP_VOLUME_USD,
): FairPriceResult & { participatingQuotes: PerpQuote[] } {
  const participating: PerpQuote[] = [];
  const excluded: Array<{ exchange: string; reason: string }> = [];

  for (const q of quotes) {
    if (q.markPrice === null || !Number.isFinite(q.markPrice) || q.markPrice <= 0) {
      excluded.push({ exchange: q.exchange, reason: '标记价不可用' });
      continue;
    }
    if (q.volume24h !== null && q.volume24h < minVolume) {
      excluded.push({ exchange: q.exchange, reason: `24h 成交额 $${Math.round(q.volume24h)} < $${minVolume}` });
      continue;
    }
    participating.push(q);
  }

  const marks = participating.map(q => q.markPrice!);
  const fair = median(marks);

  return {
    fair,
    premium: null,
    onchainPrice: null,
    participatingExchanges: participating.map(q => q.exchange),
    excludedExchanges: excluded,
    participatingQuotes: participating,
  };
}

export function computePremium(onchainPrice: number | null, fair: number | null): number | null {
  if (onchainPrice === null || fair === null || !Number.isFinite(onchainPrice) || !Number.isFinite(fair) || fair === 0) {
    return null;
  }
  return onchainPrice / fair - 1;
}

export function annualizeFunding(rate: number, intervalHours: number): number {
  return rate * (24 / intervalHours) * 365;
}

export function funding8hEquivalent(rate: number, intervalHours: number): number {
  return rate * (8 / intervalHours);
}

export function bucketFunding8h(
  points: FundingPoint[],
  now: number,
  _intervalHours: number,
): FundingBucket[] {
  const BUCKET_MS = 8 * 3600 * 1000;
  const buckets: FundingBucket[] = [];

  for (let i = 0; i < 6; i++) {
    const bucketEnd = now - i * BUCKET_MS;
    const bucketStart = bucketEnd - BUCKET_MS;
    const label = `T-${(i + 1) * 8}h`;

    const inBucket = points.filter(p => p.time >= bucketStart && p.time < bucketEnd);
    if (inBucket.length === 0) {
      buckets.push({ label, startTime: bucketStart, rates: {} });
    } else {
      const sum = inBucket.reduce((s, p) => s + p.rate, 0);
      buckets.push({ label, startTime: bucketStart, rates: { sum: sum } });
    }
  }

  return buckets;
}

function alignToUtc8hBucket(ts: number): number {
  const d = new Date(ts);
  const h = d.getUTCHours();
  const bucket = h < 8 ? 0 : h < 16 ? 8 : 16;
  d.setUTCHours(bucket, 0, 0, 0);
  return d.getTime();
}

export function bucketFunding8hMultiExchange(
  allPoints: Record<string, { points: FundingPoint[]; intervalHours: number }>,
  now: number,
): FundingBucket[] {
  const BUCKET_MS = 8 * 3600 * 1000;
  const currentBucketStart = alignToUtc8hBucket(now);
  const buckets: FundingBucket[] = [];

  for (let i = 0; i < 6; i++) {
    const bucketStart = currentBucketStart - i * BUCKET_MS;
    const bucketEnd = bucketStart + BUCKET_MS;
    const startDate = new Date(bucketStart);
    const label = `${startDate.getUTCMonth() + 1}/${startDate.getUTCDate()} ${String(startDate.getUTCHours()).padStart(2, '0')}:00`;
    const rates: Record<string, number | null> = {};

    for (const [exchange, data] of Object.entries(allPoints)) {
      const inBucket = data.points.filter(p => p.time >= bucketStart && p.time < bucketEnd);
      if (inBucket.length === 0) {
        rates[exchange] = null;
      } else {
        const sum = inBucket.reduce((s, p) => s + p.rate, 0);
        rates[exchange] = sum;
      }
    }

    buckets.push({ label, startTime: bucketStart, rates });
  }

  return buckets;
}

export function bestShortExchange(quotes: PerpQuote[]): PerpQuote | null {
  const valid = quotes.filter(q =>
    q.fundingRate !== null && Number.isFinite(q.fundingRate) &&
    q.volume24h !== null && q.volume24h >= MIN_PERP_VOLUME_USD
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const aAnn = annualizeFunding(a.fundingRate!, a.fundingIntervalHours);
    const bAnn = annualizeFunding(b.fundingRate!, b.fundingIntervalHours);
    if (bAnn !== aAnn) return bAnn - aAnn;
    return (b.volume24h ?? 0) - (a.volume24h ?? 0);
  });
  return valid[0];
}

export function bestLongExchange(quotes: PerpQuote[]): PerpQuote | null {
  const valid = quotes.filter(q =>
    q.fundingRate !== null && Number.isFinite(q.fundingRate) &&
    q.volume24h !== null && q.volume24h >= MIN_PERP_VOLUME_USD
  );
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const aAnn = annualizeFunding(a.fundingRate!, a.fundingIntervalHours);
    const bAnn = annualizeFunding(b.fundingRate!, b.fundingIntervalHours);
    if (aAnn !== bAnn) return aAnn - bAnn;
    return (b.volume24h ?? 0) - (a.volume24h ?? 0);
  });
  return valid[0];
}

export function buildSignals(
  premium: number | null,
  _onchainPrice: number | null,
  _fair: number | null,
  participatingCount: number,
  mainPoolLiquidity: number | null,
  session: MarketSession,
  shortBest: PerpQuote | null,
  longBest: PerpQuote | null,
  amountAnalysis?: AmountAnalysis | null,
  amountUsdg?: number,
): StockSignal[] {
  const signals: StockSignal[] = [];

  if (premium !== null && Number.isFinite(premium)) {
    const pctStr = `${premium >= 0 ? '+' : ''}${(premium * 100).toFixed(2)}%`;
    if (Math.abs(premium) <= PREMIUM_THRESHOLD) {
      signals.push({
        text: `链上价较 ${participatingCount} 所公允价 ${pctStr}，在 ±0.5% 内，链上买卖都不吃亏`,
        color: 'green',
      });
    } else if (premium > PREMIUM_THRESHOLD) {
      signals.push({
        text: `链上溢价 ${pctStr}：链上买入不划算（链上卖出 / CEX 买入更优）`,
        color: 'red',
      });
    } else {
      signals.push({
        text: `链上折价 ${pctStr}：链上买入划算`,
        color: 'blue',
      });
    }
  }

  if (shortBest) {
    const ann = annualizeFunding(shortBest.fundingRate!, shortBest.fundingIntervalHours);
    const meta = EXCHANGE_META[shortBest.exchange] ?? { name: shortBest.exchange };
    const vol = shortBest.volume24h !== null ? `$${(shortBest.volume24h / 1e6).toFixed(2)}M` : '—';
    signals.push({
      text: `开空成本最低：${meta.name} ${shortBest.contract} ${(shortBest.fundingRate! * 100).toFixed(4)}%（年化 ${(ann * 100).toFixed(1)}%），24h 成交 ${vol}`,
      color: 'green',
    });
  }

  if (longBest) {
    const ann = annualizeFunding(longBest.fundingRate!, longBest.fundingIntervalHours);
    const meta = EXCHANGE_META[longBest.exchange] ?? { name: longBest.exchange };
    const vol = longBest.volume24h !== null ? `$${(longBest.volume24h / 1e6).toFixed(2)}M` : '—';
    signals.push({
      text: `开多成本最低：${meta.name} ${longBest.contract} ${(longBest.fundingRate! * 100).toFixed(4)}%（年化 ${(ann * 100).toFixed(1)}%），24h 成交 ${vol}`,
      color: 'green',
    });
  }

  if (session.state !== 'regular') {
    signals.push({
      text: `${session.label}：永续价格由各所内部指数/周末定价驱动，溢价参考性下降`,
      color: 'orange',
    });
  }

  if (participatingCount === 0) {
    signals.push({
      text: '无永续合约，无法计算公允价',
      color: 'gray',
    });
  } else if (participatingCount === 1) {
    signals.push({
      text: '公允价样本不足（仅 1 所）',
      color: 'orange',
    });
  }

  if (mainPoolLiquidity !== null && mainPoolLiquidity < MIN_POOL_LIQUIDITY_WARN) {
    signals.push({
      text: `链上主池流动性不足 $${(MIN_POOL_LIQUIDITY_WARN / 1000).toFixed(0)}k，价格可能失真`,
      color: 'orange',
    });
  }

  if (amountAnalysis && amountUsdg && amountUsdg > 0) {
    const amt = `$${amountUsdg.toLocaleString()}`;
    const buyMainFailed = amountAnalysis.buyStats?.mainPoolFailed ?? false;
    const sellMainFailed = amountAnalysis.sellStats?.mainPoolFailed ?? false;
    if (amountAnalysis.buyResult) {
      const pStr = amountAnalysis.buyPremium !== null ? `${amountAnalysis.buyPremium >= 0 ? '+' : ''}${(amountAnalysis.buyPremium * 100).toFixed(2)}%` : '';
      const via = amountAnalysis.buyResult.quotedVia;
      const buyWarn = !buyMainFailed && amountAnalysis.buyPremium !== null && amountAnalysis.buyPremium > 0.005;
      const mainFailNote = buyMainFailed ? '（主池报价失败，结果可能非最优）' : '';
      signals.push({
        text: `链上买入 ${amt}：成交均价 $${amountAnalysis.buyResult.effectivePrice.toFixed(4)}，较公允价 ${pStr}${buyWarn ? '，链上买入不划算' : ''}${mainFailNote}（${via}）`,
        color: buyWarn ? 'red' : 'green',
      });
    }
    if (amountAnalysis.sellResult) {
      const pStr = amountAnalysis.sellPremium !== null ? `${amountAnalysis.sellPremium >= 0 ? '+' : ''}${(amountAnalysis.sellPremium * 100).toFixed(2)}%` : '';
      const via = amountAnalysis.sellResult.quotedVia;
      const sellWarn = !sellMainFailed && amountAnalysis.sellPremium !== null && amountAnalysis.sellPremium < -0.005;
      const mainFailNote = sellMainFailed ? '（主池报价失败，结果可能非最优）' : '';
      signals.push({
        text: `链上卖出 ${amt}：成交均价 $${amountAnalysis.sellResult.effectivePrice.toFixed(4)}，较公允价 ${pStr}${sellWarn ? '，链上卖出不划算' : ''}${mainFailNote}（${via}）`,
        color: sellWarn ? 'red' : 'green',
      });
    }
    if (!amountAnalysis.buyResult && !amountAnalysis.sellResult) {
      signals.push({
        text: `链上 ${amt} 无可报价的 Uniswap 池`,
        color: 'gray',
      });
    }
  }

  return signals;
}
