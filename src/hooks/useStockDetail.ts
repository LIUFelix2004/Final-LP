import { useState, useEffect, useRef, useCallback } from 'react';
import type { StockFeeRow, PerpQuote, FairPriceResult, FundingBucket, StockSignal } from '../types/stocks';
import { PERP_REFRESH_INTERVAL_MS, FUNDING_HISTORY_CACHE_MS } from '../config/stocks';
import { fetchAllPerpData, getQuotesForStock, fetchFundingHistoryForStock } from '../services/stocks/perps/index';
import type { AllPerpData } from '../services/stocks/perps/index';
import { computeFairPrice, computePremium, bestShortExchange, bestLongExchange, buildSignals, bucketFunding8hMultiExchange } from '../services/stocks/fairPrice';
import { getUsMarketSession } from '../services/stocks/marketSession';
import { analyzeAmount, type AmountAnalysis } from '../services/stocks/quote';

const STALE_MAX_MS = 120_000;
const EXCHANGE_KEYS = ['binance', 'okx', 'gate', 'bybit', 'hyperliquid'] as const;
type ExchangeKey = typeof EXCHANGE_KEYS[number];

export function useStockDetail(selectedRow: StockFeeRow | null, autoRefresh: boolean) {
  const [perpData, setPerpData] = useState<AllPerpData | null>(null);
  const [quotes, setQuotes] = useState<PerpQuote[]>([]);
  const [fairResult, setFairResult] = useState<FairPriceResult | null>(null);
  const [premium, setPremium] = useState<number | null>(null);
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [fundingBuckets, setFundingBuckets] = useState<FundingBucket[]>([]);
  const [perpErrors, setPerpErrors] = useState<string[]>([]);
  const [perpLoading, setPerpLoading] = useState(false);
  const [klineData, setKlineData] = useState<unknown[] | null>(null);
  const [klineSource, setKlineSource] = useState<string | null>(null);
  const [perpStale, setPerpStale] = useState(false);
  const [lastPerpSuccess, setLastPerpSuccess] = useState<Date | null>(null);

  const generationRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fundingCacheRef = useRef<Map<string, { data: Record<string, { points: Array<{ time: number; rate: number }>; intervalHours: number }>; time: number }>>(new Map());
  const lastGoodPerExRef = useRef<Map<ExchangeKey, { data: AllPerpData[ExchangeKey]; time: number }>>(new Map());

  const fetchPerps = useCallback(async () => {
    const gen = ++generationRef.current;
    setPerpLoading(true);
    try {
      const data = await fetchAllPerpData();
      if (gen !== generationRef.current) return;

      let anyStale = false;
      const errors = [...data.errors];
      const patched: AllPerpData = { ...data };

      for (const key of EXCHANGE_KEYS) {
        if (data[key] !== null) {
          lastGoodPerExRef.current.set(key, { data: data[key], time: Date.now() });
        } else {
          const cached = lastGoodPerExRef.current.get(key);
          if (cached && Date.now() - cached.time <= STALE_MAX_MS) {
            (patched as unknown as Record<string, unknown>)[key] = cached.data;
            anyStale = true;
            const exName = key.charAt(0).toUpperCase() + key.slice(1);
            if (!errors.some(e => e.startsWith(`${exName}:`))) {
              errors.push(`${exName}: 数据延迟`);
            } else {
              const idx = errors.findIndex(e => e.startsWith(`${exName}:`));
              if (idx >= 0) errors[idx] = errors[idx] + '（数据延迟）';
            }
          }
        }
      }

      patched.errors = errors;
      setPerpData(patched);
      setPerpErrors(errors);
      setPerpStale(anyStale);
      if (!anyStale) setLastPerpSuccess(new Date());
      else if (lastGoodPerExRef.current.size > 0) {
        const times = [...lastGoodPerExRef.current.values()].map(v => v.time);
        setLastPerpSuccess(new Date(Math.max(...times)));
      }
    } catch (err) {
      if (gen !== generationRef.current) return;
      setPerpErrors([err instanceof Error ? err.message : String(err)]);
      setPerpStale(false);
    } finally {
      setPerpLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPerps();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchPerps, PERP_REFRESH_INTERVAL_MS);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPerps, autoRefresh]);

  const selectedSymbol = selectedRow?.symbol ?? null;
  const selectedOnchainPrice = selectedRow?.onchainPrice ?? null;
  const selectedMainPoolLiq = selectedRow?.mainPool?.liquidityUsd ?? null;

  const [amountUsdg, setAmountUsdg] = useState(() => {
    try {
      const saved = localStorage.getItem('stocks-amount-usdg-v1');
      if (saved) { const n = Number(saved); if (Number.isFinite(n) && n > 0) return n; }
    } catch {}
    return 2000;
  });
  const [amountAnalysis, setAmountAnalysis] = useState<AmountAnalysis | null>(null);
  const [amountLoading, setAmountLoading] = useState(false);
  const [amountProgress, setAmountProgress] = useState('');
  const amountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountGenRef = useRef(0);

  useEffect(() => {
    if (!selectedSymbol || !perpData) {
      setQuotes([]);
      setFairResult(null);
      setPremium(null);
      setSignals([]);
      return;
    }

    const q = getQuotesForStock(selectedSymbol, perpData);
    setQuotes(q);

    const result = computeFairPrice(q);
    const prem = computePremium(selectedOnchainPrice, result.fair);
    result.premium = prem;
    result.onchainPrice = selectedOnchainPrice;
    setFairResult(result);
    setPremium(prem);

    const session = getUsMarketSession();
    const shortBest = bestShortExchange(q);
    const longBest = bestLongExchange(q);
    const sigs = buildSignals(
      prem,
      selectedOnchainPrice,
      result.fair,
      result.participatingExchanges.length,
      selectedMainPoolLiq,
      session,
      shortBest,
      longBest,
      amountAnalysis,
      amountUsdg,
    );
    setSignals(sigs);
  }, [selectedSymbol, selectedOnchainPrice, selectedMainPoolLiq, perpData, amountAnalysis, amountUsdg]);

  useEffect(() => {
    if (!selectedRow) {
      setFundingBuckets([]);
      return;
    }
    const symbol = selectedRow.symbol;

    const cached = fundingCacheRef.current.get(symbol);
    if (cached && Date.now() - cached.time < FUNDING_HISTORY_CACHE_MS) {
      setFundingBuckets(bucketFunding8hMultiExchange(cached.data, Date.now()));
      return;
    }

    let cancelled = false;
    fetchFundingHistoryForStock(symbol).then(result => {
      if (cancelled) return;
      fundingCacheRef.current.set(symbol, { data: result, time: Date.now() });
      setFundingBuckets(bucketFunding8hMultiExchange(result, Date.now()));
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [selectedRow?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setKlineData(null);
    setKlineSource(null);
    if (!selectedRow) {
      return;
    }
    const symbol = selectedRow.symbol;
    let cancelled = false;

    async function loadKline() {
      try {
        const resp = await fetch(`/api/cex/binance/fapi/v1/klines?symbol=${symbol}USDT&interval=1h&limit=168`);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        if (!cancelled) {
          setKlineData(data);
          setKlineSource(`Binance ${symbol}USDT`);
        }
      } catch {
        try {
          const resp = await fetch('/api/cex/hl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'candleSnapshot',
              req: {
                coin: `xyz:${symbol}`,
                interval: '1h',
                startTime: Date.now() - 168 * 3600_000,
                endTime: Date.now(),
              },
            }),
          });
          if (resp.ok && !cancelled) {
            const data = await resp.json();
            setKlineData(data);
            setKlineSource(`Hyperliquid xyz:${symbol}`);
          }
        } catch { /* no kline available */ }
      }
    }

    loadKline();
    return () => { cancelled = true; };
  }, [selectedRow?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem('stocks-amount-usdg-v1', String(amountUsdg)); } catch {}
  }, [amountUsdg]);

  useEffect(() => {
    const gen = ++amountGenRef.current;
    if (!selectedRow || amountUsdg <= 0) {
      setAmountAnalysis(null);
      return;
    }

    if (amountTimerRef.current) clearTimeout(amountTimerRef.current);

    amountTimerRef.current = setTimeout(async () => {
      if (gen !== amountGenRef.current) return;
      setAmountLoading(true);
      setAmountProgress('');
      try {
        const result = await analyzeAmount(
          selectedRow.pools, amountUsdg, fairResult?.fair ?? null,
          (msg) => { if (gen === amountGenRef.current) setAmountProgress(msg); },
        );
        if (gen !== amountGenRef.current) return;
        setAmountAnalysis(result);
      } catch {
        if (gen !== amountGenRef.current) return;
        setAmountAnalysis(null);
      } finally {
        if (gen === amountGenRef.current) { setAmountLoading(false); setAmountProgress(''); }
      }
    }, 800);

    return () => {
      if (amountTimerRef.current) clearTimeout(amountTimerRef.current);
    };
  }, [selectedRow?.symbol, amountUsdg, fairResult?.fair]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
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
    amountUsdg,
    setAmountUsdg,
    amountAnalysis,
    amountLoading,
    amountProgress,
    lastPerpSuccess,
  };
}
