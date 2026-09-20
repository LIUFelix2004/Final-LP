import type { PoolData, SortField, SortDirection, TimeWindow } from '../types';
import { TIME_WINDOW_LABELS } from '../types';
import { CHAINS } from '../config/chains';
import { formatUsd, formatPrice, formatFeeRate, formatPercent, formatNumber } from '../utils/format';
import { RankBadge } from './RankBadge';

interface Props {
  pools: PoolData[];
  sortField: SortField;
  sortDir: SortDirection;
  onSort: (field: SortField) => void;
  chainId: number;
  isEmpty: boolean;
  hasError: boolean;
  timeWindow: TimeWindow;
  isWatchlisted: (addr: string) => boolean;
  onToggleWatchlist: (addr: string) => void;
}

const DEX_COLORS: Record<string, string> = {
  PancakeSwap: '#1FC7D4',
  Uniswap: '#FF007A',
  SushiSwap: '#FA52A0',
  Thena: '#8B5CF6',
  BiSwap: '#1263F1',
  UP33: '#10B981',
};

const VERSION_COLORS: Record<string, string> = {
  V2: '#6B7280',
  V3: '#3B82F6',
  V4: '#8B5CF6',
};

interface ColumnDef {
  key: SortField | 'rank' | 'pair' | 'actions';
  label: string | ((tw: TimeWindow) => string);
  sortable: boolean;
  align?: 'left' | 'right' | 'center';
  title?: string | ((tw: TimeWindow) => string);
}

const COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', sortable: false, align: 'center' },
  { key: 'pair', label: '交易对', sortable: false, align: 'left' },
  { key: 'priceUsd', label: '价格', sortable: true, align: 'right' },
  { key: 'feeRate', label: '费率', sortable: true, align: 'right', title: 'V2: fixed rate; V3/CL: on-chain fee(); V4: pool key fee' },
  {
    key: 'feeUsd',
    label: (tw) => `Fee (${TIME_WINDOW_LABELS[tw]})*`,
    sortable: true,
    align: 'right',
    title: (tw) => `Estimated: ${TIME_WINDOW_LABELS[tw]} Volume × Fee Rate`,
  },
  { key: 'tvlUsd', label: 'TVL', sortable: true, align: 'right' },
  { key: 'feeTvlRatio', label: 'Fee/TVL', sortable: true, align: 'right', title: 'Estimated Fee ÷ TVL' },
  {
    key: 'volumeUsd',
    label: (tw) => `Volume (${TIME_WINDOW_LABELS[tw]})`,
    sortable: true,
    align: 'right',
  },
  { key: 'txCount', label: '交易数', sortable: true, align: 'right' },
  { key: 'actions', label: '操作', sortable: false, align: 'center' },
];

function resolveLabel(label: string | ((tw: TimeWindow) => string), tw: TimeWindow): string {
  return typeof label === 'function' ? label(tw) : label;
}

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

export function PoolTable({ pools, sortField, sortDir, onSort, chainId, isEmpty, hasError, timeWindow, isWatchlisted, onToggleWatchlist }: Props) {
  const chain = CHAINS[chainId];
  const twLabel = TIME_WINDOW_LABELS[timeWindow];

  const emptyMessage = hasError
    ? '获取数据失败，请点击重试'
    : isEmpty
    ? '该链暂无可用池数据'
    : '暂无数据';

  return (
    <div className="table-wrapper">
      <table className="pool-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => {
              const label = resolveLabel(col.label, timeWindow);
              const title = col.title
                ? (typeof col.title === 'function' ? col.title(timeWindow) : col.title)
                : undefined;
              return (
                <th
                  key={col.key}
                  className={`${col.align || 'left'} ${col.sortable ? 'sortable' : ''}`}
                  onClick={() => col.sortable && onSort(col.key as SortField)}
                  title={title}
                >
                  {label}
                  {col.sortable && (
                    <SortIndicator field={col.key} sortField={sortField} sortDir={sortDir} />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {pools.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="empty-state">
                {emptyMessage}
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
                    className={`action-btn star-btn ${isWatchlisted(pool.pairAddress) ? 'starred' : ''}`}
                    title={isWatchlisted(pool.pairAddress) ? '取消自选' : '加入自选'}
                    onClick={() => onToggleWatchlist(pool.pairAddress)}
                  >
                    {isWatchlisted(pool.pairAddress) ? '★' : '☆'}
                  </button>
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
      {pools.length > 0 && (
        <div className="table-footer">
          * Fee = estimated {twLabel} Volume × Fee Rate.
          {timeWindow === 'm15' && ' 15m volume is locally sampled (approximate).'}
          {' '}V3/CL fee rates read on-chain when RPC available.
        </div>
      )}
    </div>
  );
}
