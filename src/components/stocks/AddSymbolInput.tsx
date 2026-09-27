import { useState, useCallback } from 'react';
import type { StockToken } from '../../types/stocks';
import { searchRegistryBySymbol, saveUserToken, verifyOfficialToken, readTokenSymbolName } from '../../services/stocks/registry';

const DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search';

interface Props {
  registry: StockToken[];
  onAdded: (token: StockToken) => void;
}

export function AddSymbolInput({ registry, onAdded }: Props) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<'idle' | 'searching' | 'warn' | 'error' | 'ok'>('idle');
  const [message, setMessage] = useState('');
  const [pendingToken, setPendingToken] = useState<StockToken | null>(null);

  const handleAdd = useCallback(async () => {
    const q = value.trim().toUpperCase();
    if (!q) return;

    const found = searchRegistryBySymbol(registry, q);
    if (found) {
      setStatus('ok');
      setMessage(`${found.symbol} 已在列表中`);
      onAdded(found);
      setValue('');
      setTimeout(() => { setStatus('idle'); setMessage(''); }, 1500);
      return;
    }

    setStatus('searching');
    setMessage(`搜索 ${q}...`);

    try {
      const resp = await fetch(`${DEXSCREENER_SEARCH}?q=${encodeURIComponent(q + ' USDG robinhood')}`);
      if (!resp.ok) throw new Error(`DexScreener: ${resp.status}`);
      const data = await resp.json();
      const pairs = (data.pairs ?? []) as Array<{
        chainId: string;
        baseToken: { address: string; symbol: string; name: string };
      }>;
      const match = pairs.find(
        p => p.chainId === 'robinhood' && p.baseToken.symbol.toUpperCase() === q,
      );
      if (!match) {
        setStatus('error');
        setMessage(`未找到 ${q}`);
        return;
      }

      const addr = match.baseToken.address.toLowerCase();
      setMessage('验证 BeaconProxy...');
      const isOfficial = await verifyOfficialToken(addr);

      if (isOfficial) {
        const { symbol, name } = await readTokenSymbolName(addr);
        const token: StockToken = { address: addr, symbol, name: name.replace(/\s*•\s*Robinhood Token$/, ''), official: true };
        saveUserToken(token);
        onAdded(token);
        setStatus('ok');
        setMessage(`已添加 ${symbol}`);
        setValue('');
        setTimeout(() => { setStatus('idle'); setMessage(''); }, 1500);
      } else {
        const { symbol, name } = await readTokenSymbolName(addr);
        const token: StockToken = { address: addr, symbol, name: name.replace(/\s*•\s*Robinhood Token$/, ''), official: false };
        setPendingToken(token);
        setStatus('warn');
        setMessage(`${symbol} 非官方`);
      }
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, [value, registry, onAdded]);

  const handleForceAdd = useCallback(() => {
    if (!pendingToken) return;
    saveUserToken(pendingToken);
    onAdded(pendingToken);
    setStatus('ok');
    setMessage(`已添加 ${pendingToken.symbol}（非官方）`);
    setValue('');
    setPendingToken(null);
    setTimeout(() => { setStatus('idle'); setMessage(''); }, 1500);
  }, [pendingToken, onAdded]);

  return (
    <div className="add-symbol-wrap">
      <input
        type="text"
        className="add-symbol-input"
        placeholder="加代码 如 AVGO"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
      />
      <button
        className="add-symbol-btn"
        onClick={handleAdd}
        disabled={status === 'searching' || !value.trim()}
      >
        {status === 'searching' ? '...' : '+'}
      </button>
      {message && <span className={`add-symbol-msg ${status}`}>{message}</span>}
      {status === 'warn' && (
        <button className="add-symbol-force" onClick={handleForceAdd}>仍然添加</button>
      )}
    </div>
  );
}
