import { CHAINS } from '../config/chains';

interface Props {
  activeChainId: number;
  onSwitch: (chainId: number) => void;
}

export function ChainSwitcher({ activeChainId, onSwitch }: Props) {
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
    </div>
  );
}
