interface Props {
  rank: number;
}

export function RankBadge({ rank }: Props) {
  if (rank <= 3) {
    const colors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    return (
      <span className="rank-badge" style={{ color: colors[rank - 1] }}>
        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
      </span>
    );
  }
  return <span className="rank-num">{rank}</span>;
}
