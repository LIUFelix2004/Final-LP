import { useState } from 'react';

interface Props {
  watchlistOnly: boolean;
  onToggleFilter: (on: boolean) => void;
  onAddPool: (address: string) => void;
  watchlistCount: number;
}

export function WatchlistControls({ watchlistOnly, onToggleFilter, onAddPool, watchlistCount }: Props) {
  const [inputOpen, setInputOpen] = useState(false);
  const [address, setAddress] = useState('');

  const handleAdd = () => {
    const trimmed = address.trim();
    if (trimmed.length >= 10) {
      onAddPool(trimmed);
      setAddress('');
      setInputOpen(false);
    }
  };

  return (
    <div className="watchlist-controls">
      <label className="watchlist-filter">
        <input
          type="checkbox"
          checked={watchlistOnly}
          onChange={(e) => onToggleFilter(e.target.checked)}
        />
        仅看自选
        {watchlistCount > 0 && <span className="watchlist-badge">{watchlistCount}</span>}
      </label>

      {inputOpen ? (
        <div className="watchlist-input-row">
          <input
            className="watchlist-input"
            type="text"
            placeholder="粘贴池地址..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <button className="refresh-btn" onClick={handleAdd}>添加</button>
          <button className="refresh-btn" onClick={() => { setInputOpen(false); setAddress(''); }}>取消</button>
        </div>
      ) : (
        <button className="refresh-btn" onClick={() => setInputOpen(true)}>
          + 添加池地址
        </button>
      )}
    </div>
  );
}
