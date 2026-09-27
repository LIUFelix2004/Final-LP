import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./App', () => ({ default: () => null }));
vi.mock('./components/stocks/StocksBoard', () => ({ StocksBoard: () => null }));

const { loadBoardState, saveBoardState } = await import('./AppShell');

const BOARD_KEY = 'final-lp-board-v2';

describe('AppShell board state persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to lp board', () => {
    const state = loadBoardState();
    expect(state.board).toBe('lp');
    expect(state.lpChainId).toBeUndefined();
  });

  it('preserves lpChainId when switching to stocks', () => {
    saveBoardState({ board: 'lp', lpChainId: 4663 });
    const prev = loadBoardState();
    expect(prev.lpChainId).toBe(4663);

    const next = { ...prev, board: 'stocks' as const };
    saveBoardState(next);
    const loaded = loadBoardState();
    expect(loaded.board).toBe('stocks');
    expect(loaded.lpChainId).toBe(4663);
  });

  it('preserves lpChainId when switching back to lp', () => {
    saveBoardState({ board: 'stocks', lpChainId: 8453 });
    const prev = loadBoardState();
    const next = { board: 'lp' as const, lpChainId: prev.lpChainId };
    saveBoardState(next);
    const loaded = loadBoardState();
    expect(loaded.board).toBe('lp');
    expect(loaded.lpChainId).toBe(8453);
  });

  it('handles legacy v1 storage', () => {
    localStorage.setItem('final-lp-board-v1', 'stocks');
    const state = loadBoardState();
    expect(state.board).toBe('stocks');
  });

  it('handles corrupted storage gracefully', () => {
    localStorage.setItem(BOARD_KEY, 'not valid json{{');
    const state = loadBoardState();
    expect(state.board).toBe('lp');
  });
});
