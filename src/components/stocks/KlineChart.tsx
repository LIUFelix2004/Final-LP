interface Props {
  data: number[][] | null;
  width?: number;
  height?: number;
}

export function KlineChart({ data, width = 600, height = 200 }: Props) {
  if (!data || data.length === 0) {
    return <div className="kline-empty">暂无 K 线数据</div>;
  }

  const closes = data.map(d => {
    if (Array.isArray(d) && d.length >= 5) return Number(d[4]);
    if (typeof d === 'object' && 'c' in d) return Number((d as Record<string, unknown>).c);
    return NaN;
  }).filter(Number.isFinite);

  if (closes.length < 2) {
    return <div className="kline-empty">K 线数据不足</div>;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pad = 20;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;

  const points = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * chartW;
    const y = pad + chartH - ((c - min) / range) * chartH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const first = closes[0];
  const last = closes[closes.length - 1];
  const color = last >= first ? 'var(--accent-green)' : 'var(--accent-red)';

  const gridLines = 4;
  const grids = [];
  for (let i = 0; i <= gridLines; i++) {
    const y = pad + (i / gridLines) * chartH;
    const price = max - (i / gridLines) * range;
    grids.push({ y, price: price.toFixed(2) });
  }

  return (
    <div className="kline-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxHeight: height }}>
        {grids.map((g, i) => (
          <g key={i}>
            <line
              x1={pad} y1={g.y} x2={width - pad} y2={g.y}
              stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3"
            />
            <text x={width - pad + 4} y={g.y + 3} fontSize="9" fill="var(--text-muted)">{g.price}</text>
          </g>
        ))}
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div className="kline-meta">
        <span>1H K线 × {closes.length}</span>
        <span style={{ color }}>{last >= first ? '+' : ''}{((last / first - 1) * 100).toFixed(2)}%</span>
      </div>
    </div>
  );
}
