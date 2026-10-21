import type { RankHistory } from '../../lib/page-detail-data';

const width = 760;
const height = 264;
const left = 42;
const right = 14;
const top = 16;
const bottom = 38;
const plotWidth = width - left - right;
const plotHeight = height - top - bottom;

function localDate(point: RankHistory['history'][number]): string {
  return point.date ?? `${point.snapshotDate} UTC`;
}

export function RankHistoryChart({ data }: { data: RankHistory }) {
  const history = data.history;
  const times = history.map((point) => Date.parse(point.snapshotAt));
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const points = history.map((point, index) => ({
    x: firstTime === lastTime
      ? left + plotWidth / 2
      : left + ((times[index] - firstTime) / (lastTime - firstTime)) * plotWidth,
    y: top + ((point.position - 1) / 99) * plotHeight,
  }));
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const labelIndices = [...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])];

  return (
    <>
      <p id="rank-chart-description" className="mb-3 text-xs text-ink-muted">
        Position over time · 1 is the best rank · Dates in {data.timezone}
      </p>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-labelledby="rank-chart-title"
          aria-describedby="rank-chart-description"
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full min-w-[47.5rem]"
        >
        <title id="rank-chart-title">Ranking position history for {data.keyword?.phrase ?? 'selected keyword'}</title>
        {[1, 25, 50, 75, 100].map((position) => {
          const y = top + ((position - 1) / 99) * plotHeight;
          return (
            <g key={position}>
              <line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--line-subtle)" strokeWidth="1" />
              <text x={left - 9} y={y + 4} textAnchor="end" fill="var(--ink-tertiary)" fontSize="11" fontFamily="var(--font-plex-mono)">
                {position}
              </text>
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--accent-base)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {points.length === 1 && <circle cx={points[0].x} cy={points[0].y} r="4" fill="var(--accent-base)" />}
        {labelIndices.map((index) => (
          <text
            key={index}
            x={points[index].x}
            y={height - 9}
            textAnchor={index === 0 ? 'start' : index === history.length - 1 ? 'end' : 'middle'}
            fill="var(--ink-tertiary)"
            fontSize="11"
            fontFamily="var(--font-plex-mono)"
          >
            {localDate(history[index])}
          </text>
        ))}
        </svg>
      </div>
      <details className="mt-5 border-t border-line pt-4 text-sm">
        <summary className="w-fit cursor-pointer rounded-control font-medium text-accent hover:text-accent-hover">
          View {history.length} rank observations
        </summary>
        <div className="mt-4 max-h-72 overflow-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <caption className="sr-only">Rank observations by local date and UTC snapshot timestamp</caption>
            <thead className="border-b border-line text-ink-muted">
              <tr>
                <th scope="col" className="pb-2 font-medium">Local date</th>
                <th scope="col" className="pb-2 font-medium">Snapshot at (UTC)</th>
                <th scope="col" className="pb-2 text-right font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {history.map((point) => (
                <tr key={point.snapshotAt} className="border-b border-line">
                  <td className="py-2 font-mono tabular-nums">{localDate(point)}</td>
                  <td className="py-2 font-mono tabular-nums text-ink-muted">{new Date(point.snapshotAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{point.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}