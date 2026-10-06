'use client';

/** Point d'une série : libellé (jour) et valeur. */
export interface Point {
  label: string;
  value: number;
}

const W = 600;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

/**
 * Courbe d'une série par jour (phase 22), en SVG sans dépendance : responsive (viewBox), valeur de
 * chaque point au survol, résumé lisible par les lecteurs d'écran.
 */
export function LineChart({
  data,
  format,
  label,
}: {
  data: Point[];
  format: (value: number) => string;
  label: string;
}) {
  if (data.length === 0)
    return <p className="text-sm text-muted">Pas de données sur la période.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i: number) =>
    PAD.left +
    (data.length === 1
      ? (W - PAD.left - PAD.right) / 2
      : (i * (W - PAD.left - PAD.right)) / (data.length - 1));
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const line = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const area = `${x(0)},${H - PAD.bottom} ${line} ${x(data.length - 1)},${H - PAD.bottom}`;
  const total = data.reduce((s, d) => s + d.value, 0);
  const best = data.reduce((a, b) => (b.value > a.value ? b : a));
  // Une étiquette d'axe sur quelques jours seulement, pour rester lisible sur smartphone
  const every = Math.max(1, Math.ceil(data.length / 6));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${label} : total ${format(total)}, maximum ${format(best.value)} le ${best.label}.`}
      className="h-auto w-full"
    >
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={H - PAD.bottom}
        y2={H - PAD.bottom}
        className="stroke-border"
      />
      <polygon points={area} className="fill-accent/15" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2.5}
        strokeLinejoin="round"
        className="stroke-deep-blue"
      />
      {data.map((d, i) => (
        <g key={d.label}>
          <circle
            cx={x(i)}
            cy={y(d.value)}
            r={4}
            className="fill-white stroke-deep-blue"
            strokeWidth={2}
          >
            <title>{`${d.label} : ${format(d.value)}`}</title>
          </circle>
          {i % every === 0 && (
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[11px]">
              {d.label}
            </text>
          )}
        </g>
      ))}
      <text x={W - PAD.right} y={12} textAnchor="end" className="fill-muted text-[11px]">
        max {format(max)}
      </text>
    </svg>
  );
}

/** Barres horizontales comparant quelques montants (phase 22). */
export function BarChart({
  data,
  format,
}: {
  data: (Point & { tone?: 'primary' | 'danger' | 'success' | 'warning' })[];
  format: (value: number) => string;
}) {
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const color = {
    primary: 'bg-deep-blue',
    danger: 'bg-error',
    success: 'bg-synced',
    warning: 'bg-pending',
  } as const;
  return (
    <ul className="flex flex-col gap-2">
      {data.map((d) => (
        <li key={d.label} className="flex flex-col gap-1">
          <span className="flex justify-between gap-2 text-sm">
            <span className="text-text-dark">{d.label}</span>
            <span className="font-semibold text-text-dark">{format(d.value)}</span>
          </span>
          <span className="h-2.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
            <span
              className={`block h-full rounded-full ${color[d.tone ?? 'primary']}`}
              style={{ width: `${(Math.abs(d.value) / max) * 100}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
