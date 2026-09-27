import { describe, it, expect } from 'vitest';
import { formatPerpError } from './index';

describe('formatPerpError', () => {
  it('parses proxy 502 JSON with status 403 → region restriction', () => {
    const err = new Error(JSON.stringify({ exchange: 'bybit', status: 403 }));
    expect(formatPerpError('Bybit', err)).toBe('Bybit: 不可达（地区限制，检查 HTTPS_PROXY）');
  });

  it('parses proxy 502 JSON with status 451 → region restriction', () => {
    const err = new Error(JSON.stringify({ exchange: 'binance', status: 451 }));
    expect(formatPerpError('Binance', err)).toBe('Binance: 不可达（地区限制，检查 HTTPS_PROXY）');
  });

  it('parses proxy 502 JSON with status 418 → rate limit', () => {
    const err = new Error(JSON.stringify({ exchange: 'binance', status: 418 }));
    expect(formatPerpError('Binance', err)).toBe('Binance: 限流');
  });

  it('parses proxy 502 JSON with status 429 → rate limit', () => {
    const err = new Error(JSON.stringify({ exchange: 'gate', status: 429 }));
    expect(formatPerpError('Gate', err)).toBe('Gate: 限流');
  });

  it('detects timeout from error message', () => {
    const err = new Error('The operation was aborted');
    expect(formatPerpError('OKX', err)).toBe('OKX: 超时');
  });

  it('detects "timed out" from error message', () => {
    const err = new Error('Request timed out');
    expect(formatPerpError('Binance', err)).toBe('Binance: 超时');
  });

  it('detects "timeout" from error message', () => {
    const err = new Error('network timeout at: https://...');
    expect(formatPerpError('Hyperliquid', err)).toBe('Hyperliquid: 超时');
  });

  it('falls back to raw message for unknown errors', () => {
    const err = new Error('Something weird happened');
    expect(formatPerpError('Gate', err)).toBe('Gate: Something weird happened');
  });

  it('handles string reason', () => {
    expect(formatPerpError('Bybit', 'connection refused')).toBe('Bybit: connection refused');
  });
});
