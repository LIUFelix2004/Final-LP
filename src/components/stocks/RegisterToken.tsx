import { useState, useCallback } from 'react';
import { verifyOfficialToken, saveUserToken } from '../../services/stocks/registry';
import type { StockToken } from '../../types/stocks';

interface Props {
  onRegistered: (token: StockToken) => void;
}

export function RegisterToken({ onRegistered }: Props) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = useCallback(async () => {
    const addr = address.trim();
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) {
      setStatus('error');
      setMessage('地址格式无效');
      return;
    }

    setStatus('checking');
    setMessage('验证 BeaconProxy...');

    try {
      const isOfficial = await verifyOfficialToken(addr);

      const resp = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${addr}`);
      if (!resp.ok) throw new Error('DexScreener lookup failed');
      const pairs = await resp.json();

      let symbol = 'UNKNOWN';
      let name = 'Unknown Token';
      if (Array.isArray(pairs) && pairs.length > 0) {
        const pair = pairs[0];
        const baseAddr = pair.baseToken?.address?.toLowerCase();
        if (baseAddr === addr.toLowerCase()) {
          symbol = pair.baseToken.symbol ?? symbol;
          name = pair.baseToken.name ?? name;
        } else {
          symbol = pair.quoteToken?.symbol ?? symbol;
          name = pair.quoteToken?.name ?? name;
        }
      }

      const token: StockToken = {
        address: addr.toLowerCase(),
        symbol,
        name: name.replace(/\s*•\s*Robinhood Token$/, ''),
        official: isOfficial,
      };

      saveUserToken(token);
      onRegistered(token);
      setStatus('ok');
      setMessage(`已登记 ${symbol}${isOfficial ? ' (官方)' : ' (非官方)'}`);
      setAddress('');
      setTimeout(() => { setOpen(false); setStatus('idle'); setMessage(''); }, 2000);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [address, onRegistered]);

  if (!open) {
    return (
      <button className="stocks-register-btn" onClick={() => setOpen(true)}>
        + 登记合约
      </button>
    );
  }

  return (
    <div className="register-token-panel">
      <input
        type="text"
        placeholder="0x... Robinhood Chain 合约地址"
        value={address}
        onChange={e => setAddress(e.target.value)}
        className="register-input"
      />
      <button
        onClick={handleSubmit}
        disabled={status === 'checking'}
        className="register-submit"
      >
        {status === 'checking' ? '...' : '验证并登记'}
      </button>
      <button className="register-cancel" onClick={() => { setOpen(false); setStatus('idle'); }}>
        取消
      </button>
      {message && (
        <span className={`register-msg ${status}`}>{message}</span>
      )}
    </div>
  );
}
