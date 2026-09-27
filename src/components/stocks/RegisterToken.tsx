import { useState, useCallback } from 'react';
import { verifyOfficialToken, saveUserToken, readTokenSymbolName } from '../../services/stocks/registry';
import type { StockToken } from '../../types/stocks';

interface Props {
  onRegistered: (token: StockToken) => void;
}

export function RegisterToken({ onRegistered }: Props) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking' | 'ok' | 'error' | 'warn'>('idle');
  const [message, setMessage] = useState('');
  const [pendingToken, setPendingToken] = useState<StockToken | null>(null);

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

      if (!isOfficial) {
        setStatus('warn');
        setMessage('非官方 Robinhood 股票代币，拒绝添加');
        return;
      }

      setMessage('读取链上 symbol/name...');
      const { symbol, name } = await readTokenSymbolName(addr);

      const token: StockToken = {
        address: addr.toLowerCase(),
        symbol,
        name: name.replace(/\s*•\s*Robinhood Token$/, ''),
        official: true,
      };

      saveUserToken(token);
      onRegistered(token);
      setStatus('ok');
      setMessage(`已登记 ${symbol} (官方)`);
      setAddress('');
      setPendingToken(null);
      setTimeout(() => { setOpen(false); setStatus('idle'); setMessage(''); }, 2000);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [address, onRegistered]);

  const handleForceAdd = useCallback(async () => {
    if (!pendingToken) return;
    saveUserToken(pendingToken);
    onRegistered(pendingToken);
    setStatus('ok');
    setMessage(`已登记 ${pendingToken.symbol} (非官方，风险自负)`);
    setAddress('');
    setPendingToken(null);
    setTimeout(() => { setOpen(false); setStatus('idle'); setMessage(''); }, 2000);
  }, [pendingToken, onRegistered]);

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
      <button className="register-cancel" onClick={() => { setOpen(false); setStatus('idle'); setPendingToken(null); }}>
        取消
      </button>
      {message && (
        <span className={`register-msg ${status}`}>{message}</span>
      )}
      {status === 'warn' && (
        <button className="register-cancel" onClick={handleForceAdd}>
          仍然添加（风险自负）
        </button>
      )}
    </div>
  );
}
