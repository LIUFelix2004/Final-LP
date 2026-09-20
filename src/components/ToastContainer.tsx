import type { SpikeAlert } from '../services/alerts';
import { CHAINS } from '../config/chains';

interface Props {
  toasts: SpikeAlert[];
  onDismiss: (idx: number) => void;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((alert, idx) => {
        const chain = CHAINS[alert.pool.chainId];
        return (
          <div key={`${alert.pool.pairAddress}-${alert.ts}`} className="toast toast-spike">
            <div className="toast-header">
              <span className="toast-icon">🔥</span>
              <strong>Fee Spike</strong>
              <button className="toast-close" onClick={() => onDismiss(idx)}>×</button>
            </div>
            <div className="toast-body">
              <span className="toast-pair">{alert.pool.pairSymbol}</span>
              <span className="toast-chain">{chain?.shortName ?? `#${alert.pool.chainId}`}</span>
            </div>
            <div className="toast-detail">
              5m Fee: <strong>${alert.fee5m.toFixed(2)}</strong>
              {' '}(+{alert.pctChange.toFixed(0)}%, +${alert.deltaUsd.toFixed(2)})
            </div>
            <div className="toast-actions">
              <button className="toast-action-btn" onClick={() => copyToClipboard(alert.pool.pairAddress)}>
                📋 Copy
              </button>
              {chain && (
                <a
                  className="toast-action-btn"
                  href={`${chain.explorerUrl}/address/${alert.pool.pairAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🔗 Explorer
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
