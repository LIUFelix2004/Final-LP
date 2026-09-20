import type { DiscoveryMode } from '../types';

interface Props {
  mode: DiscoveryMode;
  onChange: (mode: DiscoveryMode) => void;
  gmgnAvailable: boolean;
}

export function DiscoveryToggle({ mode, onChange, gmgnAvailable }: Props) {
  return (
    <div className="discovery-toggle">
      <button
        className={`dt-btn ${mode === 'major' ? 'active' : ''}`}
        onClick={() => onChange('major')}
      >
        大盘
      </button>
      <button
        className={`dt-btn ${mode === 'gmgn' ? 'active' : ''}`}
        onClick={() => onChange('gmgn')}
        disabled={!gmgnAvailable}
        title={gmgnAvailable ? 'GMGN Smart Money' : 'Set GMGN_API_KEY in .env'}
      >
        GMGN土狗
      </button>
    </div>
  );
}
