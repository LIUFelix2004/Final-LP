import type { TimeWindow } from '../types';
import { TIME_WINDOW_LABELS } from '../types';

const WINDOWS: TimeWindow[] = ['m5', 'm15', 'h1', 'h6', 'h24'];

interface Props {
  active: TimeWindow;
  onChange: (tw: TimeWindow) => void;
}

export function TimeframeSwitcher({ active, onChange }: Props) {
  return (
    <div className="timeframe-switcher">
      {WINDOWS.map((tw) => (
        <button
          key={tw}
          className={`tf-btn ${active === tw ? 'active' : ''}`}
          onClick={() => onChange(tw)}
          title={tw === 'm15' ? 'Locally sampled — not a DexScreener native window' : undefined}
        >
          {TIME_WINDOW_LABELS[tw]}
        </button>
      ))}
    </div>
  );
}
