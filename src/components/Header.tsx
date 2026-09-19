interface Props {
  lastUpdate: Date | null;
  poolCount: number;
  loading: boolean;
  onRefresh: () => void;
  minTvl: number;
  onMinTvlChange: (val: number) => void;
}

export function Header({ lastUpdate, poolCount, loading, onRefresh, minTvl, onMinTvlChange }: Props) {
  const timeStr = lastUpdate
    ? lastUpdate.toLocaleTimeString('zh-CN', { hour12: false })
    : '--:--:--';

  return (
    <div className="header">
      <div className="header-left">
        <h1 className="title">实时榜单</h1>
        <span className="subtitle">LP Fee Leaderboard</span>
      </div>
      <div className="header-right">
        <div className="meta-info">
          <span className="meta-item">
            最近推送 <strong>{timeStr}</strong>
          </span>
          <span className="meta-item">
            当前展示 <strong>{poolCount}</strong> 条
          </span>
        </div>
        <div className="header-controls">
          <label className="tvl-filter">
            <input
              type="checkbox"
              checked={minTvl > 0}
              onChange={(e) => onMinTvlChange(e.target.checked ? 1000 : 0)}
            />
            隐藏低TVL (&lt;$1K)
          </label>
          <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? '⏳' : '🔄'} 刷新
          </button>
        </div>
      </div>
    </div>
  );
}
