import { describe, it, expect } from 'vitest';
import { parseBinanceExchangeInfo } from './binance';
import { parseOkxInstruments } from './okx';
import { parseGateContracts } from './gate';

describe('parseBinanceExchangeInfo', () => {
  it('filters EQUITY TRADING symbols', () => {
    const data = {
      symbols: [
        { symbol: 'AAPLUSDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'EQUITY', baseAsset: 'AAPL', quoteAsset: 'USDT' },
        { symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', baseAsset: 'BTC', quoteAsset: 'USDT' },
        { symbol: 'TSLAUSDT', status: 'SETTLED', contractType: 'PERPETUAL', underlyingType: 'EQUITY', baseAsset: 'TSLA', quoteAsset: 'USDT' },
      ],
    };
    const result = parseBinanceExchangeInfo(data);
    expect(result.size).toBe(1);
    expect(result.has('AAPLUSDT')).toBe(true);
    expect(result.has('BTCUSDT')).toBe(false);
    expect(result.has('TSLAUSDT')).toBe(false);
  });

  it('handles empty symbols', () => {
    expect(parseBinanceExchangeInfo({ symbols: [] }).size).toBe(0);
  });
});

describe('parseOkxInstruments', () => {
  it('filters instCategory 3 swap instruments', () => {
    const data = {
      data: [
        { instId: 'AAPL-USDT-SWAP', instCategory: '3', ctVal: '0.01', ctValCcy: 'AAPL' },
        { instId: 'BTC-USDT-SWAP', instCategory: '1', ctVal: '0.001', ctValCcy: 'BTC' },
        { instId: 'AAPL-USDT-240927', instCategory: '3', ctVal: '0.01', ctValCcy: 'AAPL' },
      ],
    };
    const result = parseOkxInstruments(data);
    expect(result.size).toBe(1);
    expect(result.has('AAPL-USDT-SWAP')).toBe(true);
  });
});

describe('parseGateContracts', () => {
  it('filters stock contracts and excludes known xStocks', () => {
    const data = [
      { name: 'AAPL_USDT', contract_type: 'stocks', funding_interval: 28800 },
      { name: 'TQQQX_USDT', contract_type: 'stocks', funding_interval: 28800 },
      { name: 'BTC_USDT', contract_type: 'direct', funding_interval: 28800 },
      { name: 'NVDA_USDT', contract_type: 'stocks', funding_interval: 28800 },
    ];
    const result = parseGateContracts(data);
    expect(result.size).toBe(2);
    expect(result.has('AAPL_USDT')).toBe(true);
    expect(result.has('NVDA_USDT')).toBe(true);
    expect(result.has('TQQQX_USDT')).toBe(false);
    expect(result.has('BTC_USDT')).toBe(false);
  });

  it('keeps NFLX_USDT (not an xStock)', () => {
    const data = [
      { name: 'NFLX_USDT', contract_type: 'stocks', funding_interval: 28800 },
      { name: 'FUTUON_USDT', contract_type: 'stocks', funding_interval: 28800 },
    ];
    const result = parseGateContracts(data);
    expect(result.size).toBe(1);
    expect(result.has('NFLX_USDT')).toBe(true);
    expect(result.has('FUTUON_USDT')).toBe(false);
  });

  it('TQQQX_USDT does not match TQQQ', () => {
    const data = [
      { name: 'TQQQX_USDT', contract_type: 'stocks', funding_interval: 28800 },
    ];
    const result = parseGateContracts(data);
    expect(result.has('TQQQX_USDT')).toBe(false);
  });
});
