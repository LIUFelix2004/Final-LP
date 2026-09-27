import { describe, it, expect } from 'vitest';
import { isAllowedCexPath } from './proxyValidation';

describe('isAllowedCexPath', () => {
  it('allows valid binance paths', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1/exchangeInfo')).toBe(true);
    expect(isAllowedCexPath('binance', '/fapi/v1/premiumIndex')).toBe(true);
    expect(isAllowedCexPath('binance', '/fapi/v1/ticker/24hr')).toBe(true);
    expect(isAllowedCexPath('binance', '/fapi/v1/fundingRate?symbol=AAPLUSDT&limit=6')).toBe(true);
    expect(isAllowedCexPath('binance', '/fapi/v1/klines?symbol=HIMSUSDT&interval=1h&limit=168')).toBe(true);
  });

  it('rejects path traversal with ..', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1/../../etc/passwd')).toBe('traversal');
  });

  it('rejects path traversal with %2e', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1/%2e%2e/secret')).toBe('traversal');
  });

  it('rejects path traversal with %2E (uppercase)', () => {
    expect(isAllowedCexPath('okx', '/api/v5/%2E%2E/admin')).toBe('traversal');
  });

  it('rejects path traversal with backslash', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1\\..\\..\\secret')).toBe('traversal');
  });

  it('rejects premiumIndexfoo (no exact match)', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1/premiumIndexfoo')).toBe(false);
  });

  it('rejects unwhitelisted binance paths', () => {
    expect(isAllowedCexPath('binance', '/fapi/v1/account')).toBe(false);
    expect(isAllowedCexPath('binance', '/sapi/v1/capital/withdraw')).toBe(false);
  });

  it('allows valid okx paths', () => {
    expect(isAllowedCexPath('okx', '/api/v5/public/instruments?instType=SWAP')).toBe(true);
    expect(isAllowedCexPath('okx', '/api/v5/market/tickers?instType=SWAP')).toBe(true);
    expect(isAllowedCexPath('okx', '/api/v5/public/funding-rate?instId=ANY')).toBe(true);
  });

  it('allows valid gate paths', () => {
    expect(isAllowedCexPath('gate', '/api/v4/futures/usdt/contracts')).toBe(true);
    expect(isAllowedCexPath('gate', '/api/v4/futures/usdt/tickers')).toBe(true);
  });

  it('allows valid bybit paths', () => {
    expect(isAllowedCexPath('bybit', '/v5/market/instruments-info?category=linear&limit=1000')).toBe(true);
    expect(isAllowedCexPath('bybit', '/v5/market/tickers?category=linear')).toBe(true);
  });

  it('allows unknown exchanges (no whitelist)', () => {
    expect(isAllowedCexPath('unknown', '/anything/goes')).toBe(true);
  });
});
