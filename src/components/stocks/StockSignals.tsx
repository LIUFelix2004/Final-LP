import type { StockSignal } from '../../types/stocks';

interface Props {
  signals: StockSignal[];
}

const COLOR_CLASS: Record<string, string> = {
  green: 'sig-info',
  blue: 'sig-info',
  orange: 'sig-warn',
  red: 'sig-danger',
  gray: 'sig-info',
};

export function StockSignals({ signals }: Props) {
  if (signals.length === 0) {
    return <div className="detail-empty">暂无信号</div>;
  }

  return (
    <div className="stock-signals">
      {signals.map((sig, i) => (
        <div key={i} className={`signal-item ${COLOR_CLASS[sig.color] ?? ''}`}>
          {sig.text}
        </div>
      ))}
    </div>
  );
}
