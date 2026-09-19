import type { PoolData, SortField, SortDirection } from '../types';
import { CHAINS } from '../config/chains';
import { formatUsd, formatPrice, formatFeeRate, formatPercent, formatNumber } from '../utils/format';
import { RankBadge } from './RankBadge';

interface Props {
  pools: PoolData[];
  sortField: SortField;
  sortDir: SortDirection;
  onSort: (field: SortField) => void;
  chainId: number;
}

const DEX_COLORS: Record<string, string> = {
  PancakeSwap: '#1FC7D4',
  Uniswap: '#FF007A',
  SushiSwap: '#FA52A0',
  Thena: '#8B5CF6',
  BiSwap: '#1263F1',
};

const VERSION_COLORS: Record<string, string> = {
  V2: '#6B7280',
  V3: '#3B82F6',
  V4: '#8B5CF6',
};

interface ColumnDef {
  key: SortField | 'rank' | 'pair' | 'actions';
  label: string;
  sortable: boolean;
  align?: 'left' | 'right' | 'center';
}

const COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', sortable: false, align: 'center' },
  { key: 'pair', label: '交易对', sortable: false, align: 'left' },
  { key: 'priceUsd', label: '价格', sortable: true, align: 'right' },
  { key: 'feeRate', label: '费率', sortable: true, align: 'right' },
  { key: 'feeUsd', label: 'Fee (24h)', sortable: true, align: 'right' },
  { key: 'tvlUsd', label: 'TVL', sortable: true, align: 'right' },
  { key: 'feeTvlRatio', label: 'Fee/TVL', sortable: true, align: 'right' },
  { key: 'volumeUsd', label: 'Volume (24h)', sortable: true, align: 'right' },
  { key: 'txCount', label: '交易数', sortable: true, align: 'right' },
  { key: 'actions', label: '操作', sortable: false, align: 'center' },
];

function SortIndicator({ field, sortField, sortDir }: { field: string; sortField: SortField; sortDir: SortDirection }) {
  if (field !== sortField) return <span className="sort-indicator inactive">↕</span>;
  return <span className="sort-indicator active">{sortDir === 'desc' ? '↓' : '↑'}</span>;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

export function PoolTable({ pools, sortField, sortDir, onSort, chainId }: Props) {
  const chain = CHAINS[chainId];

  return (
    <div className="table-wrapper">
      <table className="pool-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={`${col.align || 'left'} ${col.sortable ? 'sortable' : ''}`}
                onClick={() => col.sortable && onSort(col.key as SortField)}
              >
                {col.label}
                {col.sortable && (
                  <SortIndicator field={col.key} sortField={sortField} sortDir={sortDir} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pools.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="empty-state">
                暂无数据
              </td>
            </tr>
          ) : (
            pools.map((pool, idx) => (
              <tr key={pool.id} className={idx % 2 === 0 ? 'row-even' : 'row-odd'}>
                <td className="center">
                  <RankBadge rank={idx + 1} />
                </td>
                <td className="pair-cell">
                  <span
                    className="dex-tag"
                    style={{ backgroundColor: DEX_COLORS[pool.dex] || '#6B7280' }}
                  >
                    {pool.dex}
                  </span>
                  <span
                    className="version-tag"
                    style={{ backgroundColor: VERSION_COLORS[pool.version] || '#6B7280' }}
                  >
                    {pool.version}
                  </span>
                  <span className="pair-symbol">{pool.pairSymbol}</span>
                </td>
                <td className="right mono">{formatPrice(pool.priceUsd)}</td>
                <td className="right mono">{formatFeeRate(pool.feeRate)}</td>
                <td className="right mono fee-value">{formatUsd(pool.feeUsd, { compact: true })}</td>
                <td className="right mono">{formatUsd(pool.tvlUsd, { compact: true })}</td>
                <td className="right mono fee-tvl-value">{formatPercent(pool.feeTvlRatio)}</td>
                <td className="right mono">{formatUsd(pool.volumeUsd, { compact: true })}</td>
                <td className="right mono">{formatNumber(pool.txCount)}</td>
                <td className="center actions-cell">
                  <button
                    className="action-btn"
                    title="复制合约地址"
                    onClick={() => copyToClipboard(pool.pairAddress)}
                  >
                    📋
                  </button>
                  <a
                    className="action-btn"
                    href={`${chain.explorerUrl}/address/${pool.pairAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="区块浏览器"
                  >
                    🔗
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
