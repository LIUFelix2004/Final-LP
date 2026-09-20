import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  isWatchlisted,
  toggleWatchlist,
  clearWatchlist,
} from './watchlist';

const mockStorage = new Map<string, string>();

beforeEach(() => {
  mockStorage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mockStorage.get(k) ?? null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
  });
});

describe('watchlist', () => {
  it('starts empty', () => {
    expect(getWatchlist()).toEqual([]);
    expect(getWatchlist(56)).toEqual([]);
  });

  it('add and retrieve', () => {
    addToWatchlist('0xABC', 56);
    expect(getWatchlist(56)).toHaveLength(1);
    expect(getWatchlist(56)[0].pairAddress).toBe('0xabc');
  });

  it('normalizes address to lowercase', () => {
    addToWatchlist('0xDeAdBeEf', 56);
    expect(isWatchlisted('0xdeadbeef', 56)).toBe(true);
    expect(isWatchlisted('0xDEADBEEF', 56)).toBe(true);
  });

  it('does not duplicate', () => {
    addToWatchlist('0xABC', 56);
    addToWatchlist('0xabc', 56);
    expect(getWatchlist(56)).toHaveLength(1);
  });

  it('separate chains', () => {
    addToWatchlist('0xABC', 56);
    addToWatchlist('0xABC', 4663);
    expect(getWatchlist(56)).toHaveLength(1);
    expect(getWatchlist(4663)).toHaveLength(1);
    expect(getWatchlist()).toHaveLength(2);
  });

  it('remove', () => {
    addToWatchlist('0xABC', 56);
    removeFromWatchlist('0xABC', 56);
    expect(getWatchlist(56)).toHaveLength(0);
    expect(isWatchlisted('0xABC', 56)).toBe(false);
  });

  it('toggle adds then removes', () => {
    const r1 = toggleWatchlist('0xABC', 56);
    expect(r1.added).toBe(true);
    expect(getWatchlist(56)).toHaveLength(1);

    const r2 = toggleWatchlist('0xABC', 56);
    expect(r2.added).toBe(false);
    expect(getWatchlist(56)).toHaveLength(0);
  });

  it('clear by chain', () => {
    addToWatchlist('0x1', 56);
    addToWatchlist('0x2', 56);
    addToWatchlist('0x3', 4663);
    clearWatchlist(56);
    expect(getWatchlist(56)).toHaveLength(0);
    expect(getWatchlist(4663)).toHaveLength(1);
  });

  it('clear all', () => {
    addToWatchlist('0x1', 56);
    addToWatchlist('0x2', 4663);
    clearWatchlist();
    expect(getWatchlist()).toHaveLength(0);
  });

  it('stores note', () => {
    addToWatchlist('0xABC', 56, 'test pool');
    expect(getWatchlist(56)[0].note).toBe('test pool');
  });

  it('stores addedAt timestamp', () => {
    const before = Date.now();
    addToWatchlist('0xABC', 56);
    const after = Date.now();
    const entry = getWatchlist(56)[0];
    expect(entry.addedAt).toBeGreaterThanOrEqual(before);
    expect(entry.addedAt).toBeLessThanOrEqual(after);
  });
});
