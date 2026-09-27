import { useState, useCallback } from 'react';
import App from './App';
import { StocksBoard } from './components/stocks/StocksBoard';

export type Board = 'lp' | 'stocks';

const BOARD_KEY = 'final-lp-board-v2';

interface BoardState {
  board: Board;
  lpChainId?: number;
}

function loadBoardState(): BoardState {
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

function saveBoardState(state: BoardState): void {
  try { localStorage.setItem(BOARD_KEY, JSON.stringify(state)); } catch {}
}

export function AppShell() {
  const [boardState, setBoardState] = useState<BoardState>(loadBoardState);

  const handleSelectStocks = useCallback(() => {
    setBoardState(prev => {
      const next: BoardState = { ...prev, board: 'stocks' };
      saveBoardState(next);
      return next;
    });
  }, []);

  const handleSelectLp = useCallback(() => {
    const next: BoardState = { board: 'lp', lpChainId: boardState.lpChainId };
    setBoardState(next);
    saveBoardState(next);
  }, [boardState.lpChainId]);

  const handleChainChange = useCallback((chainId: number) => {
    setBoardState(prev => {
      const next = { ...prev, lpChainId: chainId };
      saveBoardState(next);
      return next;
    });
  }, []);

  if (boardState.board === 'stocks') {
    return <StocksBoard onBack={handleSelectLp} />;
  }

  return <App onSelectStocks={handleSelectStocks} initialChainId={boardState.lpChainId} onChainChange={handleChainChange} />;
}
