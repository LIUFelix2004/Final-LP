import { useState, useEffect, useRef, useCallback } from 'react';
import type { StockFeeRow, PerpQuote, FairPriceResult, FundingBucket, StockSignal } from '../types/stocks';
import { PERP_REFRESH_INTERVAL_MS, FUNDING_HISTORY_CACHE_MS } from '../config/stocks';
import { fetchAllPerpData, getQuotesForStock, fetchFundingHistoryForStock } from '../services/stocks/perps/index';
import type { AllPerpData } from '../services/stocks/perps/index';
import { computeFairPrice, computePremium, bestShortExchange, bestLongExchange, buildSignals, bucketFunding8hMultiExchange } from '../services/stocks/fairPrice';
import { getUsMarketSession } from '../services/stocks/marketSession';
import { analyzeAmount, type AmountAnalysis } from '../services/stocks/quote';

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

  const generationRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fundingCacheRef = useRef<Map<string, { data: Record<string, { points: Array<{ time: number; rate: number }>; intervalHours: number }>; time: number }>>(new Map());
  const lastGoodPerpRef = useRef<{ data: AllPerpData; time: number } | null>(null);
  const [perpStale, setPerpStale] = useState(false);

  const STALE_MAX_MS = 120_000;

  const fetchPerps = useCallback(async () => {
    const gen = ++generationRef.current;
    setPerpLoading(true);
    try {
      const data = await fetchAllPerpData();
      if (gen !== generationRef.current) return;
      setPerpData(data);
      setPerpErrors(data.errors);
      lastGoodPerpRef.current = { data, time: Date.now() };
      setPerpStale(false);
    } catch (err) {
      if (gen !== generationRef.current) return;
      const stale = lastGoodPerpRef.current;
      if (stale && Date.now() - stale.time <= STALE_MAX_MS) {
        setPerpData(stale.data);
        setPerpErrors([...stale.data.errors, '数据延迟']);
        setPerpStale(true);
      } else {
        setPerpErrors([err instanceof Error ? err.message : String(err)]);
        setPerpStale(false);
      }
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
    );
    setSignals(sigs);
  }, [selectedSymbol, selectedOnchainPrice, selectedMainPoolLiq, perpData]);

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

  const [amountUsdg, setAmountUsdg] = useState(2000);
  const [amountAnalysis, setAmountAnalysis] = useState<AmountAnalysis | null>(null);
  const [amountLoading, setAmountLoading] = useState(false);
  const amountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!selectedRow || amountUsdg <= 0) {
      setAmountAnalysis(null);
      return;
    }

    if (amountTimerRef.current) clearTimeout(amountTimerRef.current);

    amountTimerRef.current = setTimeout(async () => {
      setAmountLoading(true);
      try {
        const result = await analyzeAmount(selectedRow.pools, amountUsdg, fairResult?.fair ?? null);
        setAmountAnalysis(result);
      } catch {
        setAmountAnalysis(null);
      } finally {
        setAmountLoading(false);
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
  };
}
