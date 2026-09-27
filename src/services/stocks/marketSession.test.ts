import { describe, it, expect } from 'vitest';
import { getUsMarketSession } from './marketSession';

describe('getUsMarketSession', () => {
  it('returns closed on Saturday', () => {
    const sat = new Date('2026-09-26T16:00:00Z');
    const result = getUsMarketSession(sat);
    expect(result.state).toBe('closed');
    expect(result.reason).toBe('weekend');
  });

  it('returns closed on Sunday', () => {
    const sun = new Date('2026-09-27T16:00:00Z');
    const result = getUsMarketSession(sun);
    expect(result.state).toBe('closed');
    expect(result.reason).toBe('weekend');
  });

  it('returns closed on NYSE holiday', () => {
    const holiday = new Date('2026-01-01T18:00:00Z');
    const result = getUsMarketSession(holiday);
    expect(result.state).toBe('closed');
    expect(result.reason).toBe('holiday');
  });

  it('returns pre-market before 9:30 ET', () => {
    const pre = new Date('2026-09-28T12:00:00Z');
    const result = getUsMarketSession(pre);
    expect(result.state).toBe('pre');
    expect(result.label).toBe('盘前');
  });

  it('returns regular during trading hours', () => {
    const regular = new Date('2026-09-28T15:00:00Z');
    const result = getUsMarketSession(regular);
    expect(result.state).toBe('regular');
    expect(result.label).toBe('盘中');
  });

  it('returns post-market after 4:00 PM ET', () => {
    const post = new Date('2026-09-28T21:00:00Z');
    const result = getUsMarketSession(post);
    expect(result.state).toBe('post');
    expect(result.label).toBe('盘后');
  });

  it('returns closed for overnight', () => {
    const overnight = new Date('2026-09-29T02:00:00Z');
    const result = getUsMarketSession(overnight);
    expect(result.state).toBe('closed');
    expect(result.reason).toBe('overnight');
  });

  it('handles early close day', () => {
    const earlyClose = new Date('2026-11-27T19:00:00Z');
    const result = getUsMarketSession(earlyClose);
    expect(result.state).toBe('closed');
    expect(result.reason).toBe('early_close');
  });

  it('has correct ET time format', () => {
    const d = new Date('2026-09-28T15:30:00Z');
    const result = getUsMarketSession(d);
    expect(result.etTime).toMatch(/^\d{2}:\d{2}$/);
  });
});
