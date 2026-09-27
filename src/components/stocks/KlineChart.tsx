interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Props {
  data: number[][] | null;
  width?: number;
  height?: number;
  source?: string;
}

function parseCandle(d: unknown): Candle | null {
  if (Array.isArray(d) && d.length >= 6) {
    const o = Number(d[1]), h = Number(d[2]), l = Number(d[3]), c = Number(d[4]), v = Number(d[5]);
    if ([o, h, l, c].every(Number.isFinite)) return { o, h, l, c, v: Number.isFinite(v) ? v : 0 };
  }
  return null;
}

export function KlineChart({ data, width = 600, height = 280, source }: Props) {
  if (!data || data.length === 0) {
    return <div className="kline-empty">暂无 K 线数据</div>;
  }

  const candles = data.map(parseCandle).filter((c): c is Candle => c !== null);
  if (candles.length < 2) {
    return <div className="kline-empty">K 线数据不足</div>;
  }

  const priceH = height * 0.7;
  const volH = height * 0.2;
  const gap = height * 0.05;
  const pad = 20;
  const chartW = width - pad * 2;

  const allPrices = candles.flatMap(c => [c.h, c.l]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const rangeP = maxP - minP || 1;

  const maxVol = Math.max(...candles.map(c => c.v)) || 1;

  const barW = Math.max(1, chartW / candles.length * 0.7);
  const barGap = chartW / candles.length;

  const first = candles[0];
  const last = candles[candles.length - 1];
  const pctChange = ((last.c / first.o) - 1) * 100;
  const overall = pctChange >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  const gridLines = 4;
  const grids = [];
  for (let i = 0; i <= gridLines; i++) {
    const y = pad + (i / gridLines) * priceH;
    const price = maxP - (i / gridLines) * rangeP;
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

        {candles.map((c, i) => {
          const x = pad + i * barGap + barGap / 2;
          const isUp = c.c >= c.o;
          const color = isUp ? 'var(--accent-green)' : 'var(--accent-red)';
          const bodyTop = pad + priceH - ((Math.max(c.o, c.c) - minP) / rangeP) * priceH;
          const bodyBot = pad + priceH - ((Math.min(c.o, c.c) - minP) / rangeP) * priceH;
          const bodyH = Math.max(0.5, bodyBot - bodyTop);
          const wickTop = pad + priceH - ((c.h - minP) / rangeP) * priceH;
          const wickBot = pad + priceH - ((c.l - minP) / rangeP) * priceH;

          const volTop = pad + priceH + gap;
          const vH = (c.v / maxVol) * volH;

          return (
            <g key={i}>
              <line x1={x} y1={wickTop} x2={x} y2={wickBot} stroke={color} strokeWidth="0.8" />
              <rect x={x - barW / 2} y={bodyTop} width={barW} height={bodyH}
                fill={isUp ? 'transparent' : color} stroke={color} strokeWidth="0.8" />
              {c.v > 0 && (
                <rect x={x - barW / 2} y={volTop + volH - vH} width={barW} height={vH}
                  fill={color} opacity="0.35" />
              )}
            </g>
          );
        })}
      </svg>
      <div className="kline-meta">
        <span>{source ?? 'K线'} · 1h × {candles.length} 根 · 7 日</span>
        <span style={{ color: overall }}>{pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%</span>
      </div>
    </div>
  );
}
