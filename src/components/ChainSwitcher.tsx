import { CHAINS } from '../config/chains';

interface Props {
  activeChainId: number;
  onSwitch: (chainId: number) => void;
  onSelectStocks?: () => void;
}

export function ChainSwitcher({ activeChainId, onSwitch, onSelectStocks }: Props) {
  return (
    <div className="chain-switcher">
      {Object.values(CHAINS).map((chain) => (
        <button
          key={chain.chainId}
          className={`chain-btn ${activeChainId === chain.chainId ? 'active' : ''}`}
          onClick={() => onSwitch(chain.chainId)}
        >
          <span className="chain-dot" />
          {chain.shortName}
          <span className="chain-id">#{chain.chainId}</span>
        </button>
      ))}
      {onSelectStocks && (
        <button className="chain-btn stocks-btn" onClick={onSelectStocks}>
          <span className="chain-dot" style={{ background: '#F0B90B' }} />
          股票
        </button>
      )}
    </div>
  );
}
