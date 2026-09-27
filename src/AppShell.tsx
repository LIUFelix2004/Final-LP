import { useState, useCallback } from 'react';
import App from './App';
import { StocksBoard } from './components/stocks/StocksBoard';

export type Board = 'lp' | 'stocks';

export function AppShell() {
  const [board, setBoard] = useState<Board>('lp');

  const handleSelectStocks = useCallback(() => setBoard('stocks'), []);
  const handleSelectLp = useCallback(() => setBoard('lp'), []);

  if (board === 'stocks') {
    return <StocksBoard onBack={handleSelectLp} />;
  }

  return <App onSelectStocks={handleSelectStocks} />;
}
