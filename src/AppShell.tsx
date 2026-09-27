import { useState, useCallback } from 'react';
import App from './App';
import { StocksBoard } from './components/stocks/StocksBoard';

export type Board = 'lp' | 'stocks';

const BOARD_KEY = 'final-lp-board-v1';

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw === 'stocks') return 'stocks';
  } catch {}
  return 'lp';
}

function saveBoard(board: Board): void {
  try { localStorage.setItem(BOARD_KEY, board); } catch {}
}

export function AppShell() {
  const [board, setBoard] = useState<Board>(loadBoard);

  const handleSelectStocks = useCallback(() => {
    setBoard('stocks');
    saveBoard('stocks');
  }, []);

  const handleSelectLp = useCallback(() => {
    setBoard('lp');
    saveBoard('lp');
  }, []);

  if (board === 'stocks') {
    return <StocksBoard onBack={handleSelectLp} />;
  }

  return <App onSelectStocks={handleSelectStocks} />;
}
