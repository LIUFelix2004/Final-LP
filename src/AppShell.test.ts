import { describe, it, expect, beforeEach } from 'vitest';

const BOARD_KEY = 'final-lp-board-v2';

function loadBoardState(): { board: 'lp' | 'stocks'; lpChainId?: number } {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (!raw) {
      const legacy = localStorage.getItem('final-lp-board-v1');
      if (legacy === 'stocks') return { board: 'stocks' };
      return { board: 'lp' };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed.board === 'lp' || parsed.board === 'stocks')) {
      return { board: parsed.board, lpChainId: parsed.lpChainId };
    }
  } catch {}
  return { board: 'lp' };
}

function saveBoardState(state: { board: string; lpChainId?: number }): void {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(state)); } catch {}
}

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

    const next = { ...prev, board: 'stocks' };
    saveBoardState(next);
    const loaded = loadBoardState();
    expect(loaded.board).toBe('stocks');
    expect(loaded.lpChainId).toBe(4663);
  });

  it('preserves lpChainId when switching back to lp', () => {
    saveBoardState({ board: 'stocks', lpChainId: 8453 });
    const prev = loadBoardState();
    const next = { board: 'lp', lpChainId: prev.lpChainId };
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
