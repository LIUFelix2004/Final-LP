import { useState } from 'react';
import type { PoolData, SortField, SortDirection, TimeWindow, DiscoveryMode } from '../types';
import { TIME_WINDOW_LABELS } from '../types';
import { CHAINS } from '../config/chains';
import { GMGN_CHAIN_SLUG } from '../services/gmgn';
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
  discoveryMode: DiscoveryMode;
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

const PAGE_SIZE = 100;

interface ColumnDef {
  key: SortField | 'rank' | 'pair' | 'actions' | 'lastSmartBuyAt';
  label: string | ((tw: TimeWindow) => string);
  sortable: boolean;
  align?: 'left' | 'right' | 'center';
  title?: string | ((tw: TimeWindow) => string);
  gmgnOnly?: boolean;
  gmgnKey?: 'smartBuyUsdSum';
}

const BASE_COLUMNS: ColumnDef[] = [
  { key: 'rank', label: '#', sortable: false, align: 'center' },
  { key: 'pair', label: '交易对', sortable: false, align: 'left' },
  { key: 'smartBuyCount', label: '聪明钱买入', sortable: true, align: 'right', title: 'Smart money 24h buy count (GMGN)', gmgnOnly: true },
  { key: 'smartBuyUsdSum', label: '聪明钱买入额', sortable: true, align: 'right', title: 'Smart money buy volume USD (GMGN); 上游可能无此字段', gmgnOnly: true, gmgnKey: 'smartBuyUsdSum' },
  { key: 'lastSmartBuyAt', label: '最近买入', sortable: false, align: 'right', title: '最近聪明钱买入时间；若无则显示代币 open_timestamp', gmgnOnly: true },
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

function formatSmartBuy(count: number | undefined): string {
  if (count === undefined) return '—';
  return String(count);
}

function formatSmartBuyUsd(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatLastSmartBuy(ts: number | undefined): string {
  if (ts === undefined) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatAge(ts: number | undefined): string | null {
  if (!ts) return null;
  const diff = Date.now() - ts;
  if (diff < 0) return null;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function gmgnTokenUrl(chainId: number, pool: PoolData): string | null {
  const slug = GMGN_CHAIN_SLUG[chainId];
  if (!slug) return null;
  return `https://gmgn.ai/${slug}/token/${pool.token0Address}`;
}

export function PoolTable({ pools, sortField, sortDir, onSort, chainId, isEmpty, hasError, timeWindow, isWatchlisted, onToggleWatchlist, discoveryMode }: Props) {
  const chain = CHAINS[chainId];
  const twLabel = TIME_WINDOW_LABELS[timeWindow];
  const isGmgn = discoveryMode === 'gmgn';
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const hasSmartBuyUsd = isGmgn && pools.length > 0 &&
    pools.filter((p) => p.smartBuyUsdSum !== undefined).length > pools.length * 0.1;

  const columns = BASE_COLUMNS.filter((c) => {
    if (c.gmgnOnly && !isGmgn) return false;
    if (c.gmgnKey === 'smartBuyUsdSum' && !hasSmartBuyUsd) return false;
    return true;
  });

  const visiblePools = pools.slice(0, visibleCount);
  const hasMore = pools.length > visibleCount;

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
            {columns.map((col) => {
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
              <td colSpan={columns.length} className="empty-state">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            visiblePools.map((pool, idx) => {
              const gmgnUrl = isGmgn ? gmgnTokenUrl(chainId, pool) : null;
              const ageLabel = isGmgn ? formatAge(pool.lastSmartBuyAt) : null;
              return (
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
                    {ageLabel && (
                      <span className="age-chip" title="代币/最近买入年龄">{ageLabel}</span>
                    )}
                  </td>
                  {isGmgn && (
                    <td className="right mono smart-buy-value">
                      {formatSmartBuy(pool.smartBuyCount)}
                    </td>
                  )}
                  {isGmgn && hasSmartBuyUsd && (
                    <td className="right mono">
                      {formatSmartBuyUsd(pool.smartBuyUsdSum)}
                    </td>
                  )}
                  {isGmgn && (
                    <td className="right mono">
                      {formatLastSmartBuy(pool.lastSmartBuyAt)}
                    </td>
                  )}
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
                    {gmgnUrl && (
                      <a
                        className="action-btn"
                        href={gmgnUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="GMGN"
                      >
                        🐸
                      </a>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {hasMore && (
        <div className="load-more-row">
          <button className="refresh-btn" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
            加载更多 ({pools.length - visibleCount} 剩余)
          </button>
        </div>
      )}
      {pools.length > 0 && (
        <div className="table-footer">
          * Fee = estimated {twLabel} Volume × Fee Rate.
          {timeWindow === 'm15' && ' 15m volume is locally sampled (approximate).'}
          {' '}V3/CL fee rates read on-chain when RPC available.
          {isGmgn && ' Smart money data from GMGN (24h).'}
          {isGmgn && !hasSmartBuyUsd && ' 上游无买入额字段。'}
        </div>
      )}
    </div>
  );
}
