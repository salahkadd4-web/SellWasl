'use client';

import { useState } from 'react';

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

/** Une série d'une courbe de tendance ; `dash` distingue les séries sans compter sur la couleur. */
export interface TrendSeries {
  key: string;
  label: string;
  tone: 'primary' | 'danger' | 'warning' | 'success';
  dash?: 'solid' | 'dashed' | 'dotted';
  values: number[];
}

const TONE = {
  primary: { stroke: 'stroke-deep-blue', swatch: 'bg-deep-blue' },
  danger: { stroke: 'stroke-error', swatch: 'bg-error' },
  warning: { stroke: 'stroke-pending', swatch: 'bg-pending' },
  success: { stroke: 'stroke-synced', swatch: 'bg-synced' },
} as const;
const DASH = { solid: undefined, dashed: '7 5', dotted: '1 5' } as const;

/** Échantillon d'une série : sa couleur et son tracé (légende, infobulle). */
function Swatch({ series }: { series: TrendSeries }) {
  return (
    <svg width="18" height="8" aria-hidden="true" className="shrink-0">
      <line
        x1="1"
        x2="17"
        y1="4"
        y2="4"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={DASH[series.dash ?? 'solid']}
        className={TONE[series.tone].stroke}
      />
    </svg>
  );
}

/**
 * Courbe d'une ou plusieurs séries par période (page Statistiques), en SVG sans dépendance :
 * repère et infobulle au survol de chaque période, légende dès deux séries (couleur et tracé),
 * tableau des valeurs pour qui ne lit pas le graphique. Une seule échelle : mêmes unités.
 */
export function TrendChart({
  title,
  labels,
  series,
  format,
  detail,
}: {
  title: string;
  labels: string[];
  series: TrendSeries[];
  format: (value: number) => string;
  /** Précision d'une période (taux…), dans l'infobulle et le tableau. */
  detail?: (index: number) => string | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values);
  if (labels.length === 0 || all.every((v) => v === 0))
    return <p className="text-sm text-muted">Pas de données sur la période.</p>;
  const max = Math.max(...all, 1);
  const step = labels.length === 1 ? 0 : (W - PAD.left - PAD.right) / (labels.length - 1);
  const x = (i: number) => (labels.length === 1 ? W / 2 : PAD.left + i * step);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const every = Math.max(1, Math.ceil(labels.length / 6));
  const hitWidth = labels.length === 1 ? W - PAD.left - PAD.right : step;
  const single = series.length === 1 ? series[0] : null;
  const summary = series
    .map((s) => `${s.label} : total ${format(s.values.reduce((a, b) => a + b, 0))}`)
    .join(' ; ');

  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 && (
        <ul aria-label="Légende" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-dark">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <Swatch series={s} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title} : ${summary}.`}
          className="h-auto w-full"
        >
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={H - PAD.bottom}
            y2={H - PAD.bottom}
            className="stroke-border"
          />
          {single && (
            <polygon
              points={`${x(0)},${H - PAD.bottom} ${single.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${x(labels.length - 1)},${H - PAD.bottom}`}
              className="fill-accent/15"
            />
          )}
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-muted"
              strokeDasharray="3 3"
            />
          )}
          {series.map((s) => (
            <g key={s.key}>
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={DASH[s.dash ?? 'solid']}
                className={TONE[s.tone].stroke}
              />
              {s.values.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={active === i ? 5 : 3.5}
                  strokeWidth={2}
                  className={`fill-white ${TONE[s.tone].stroke}`}
                />
              ))}
            </g>
          ))}
          {labels.map(
            (l, i) =>
              i % every === 0 && (
                <text
                  key={l}
                  x={x(i)}
                  y={H - 8}
                  // Étiquettes des bords alignées vers l'intérieur : jamais coupées
                  textAnchor={
                    labels.length > 1 && i === 0
                      ? 'start'
                      : labels.length > 1 && i === labels.length - 1
                        ? 'end'
                        : 'middle'
                  }
                  className="fill-muted text-[11px]"
                >
                  {l}
                </text>
              ),
          )}
          <text x={W - PAD.right} y={12} textAnchor="end" className="fill-muted text-[11px]">
            max {format(max)}
          </text>
          {/* Zones de survol : toute la hauteur, plus larges que les points */}
          {labels.map((l, i) => (
            <rect
              key={l}
              data-testid={`trend-hit-${i}`}
              x={x(i) - hitWidth / 2}
              y={0}
              width={hitWidth}
              height={H}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
              onTouchStart={() => setActive(i)}
            />
          ))}
        </svg>
        {active !== null && (
          <div
            role="status"
            // Sous l'étiquette « max », qui reste lisible pendant le survol
            className="pointer-events-none absolute top-7 z-10 flex min-w-36 flex-col gap-1 rounded-lg border border-border bg-white px-3 py-2 text-sm shadow-sm"
            style={
              x(active) > W / 2
                ? { right: `${((W - x(active)) / W) * 100 + 1}%` }
                : { left: `${(x(active) / W) * 100 + 1}%` }
            }
          >
            <span className="font-semibold text-text-dark">{labels[active]}</span>
            {series.map((s) => (
              <span key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted">
                  {series.length > 1 && <Swatch series={s} />}
                  {s.label}
                </span>
                <span className="font-semibold text-text-dark">{format(s.values[active]!)}</span>
              </span>
            ))}
            {detail?.(active) && <span className="text-xs text-muted">{detail(active)}</span>}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-deep-blue">Voir les valeurs</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Période</th>
                {series.map((s) => (
                  <th key={s.key} className="py-2 pr-3 font-medium">
                    {s.label}
                  </th>
                ))}
                {detail && <th className="py-2 pr-3 font-medium">Précision</th>}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l} className="border-t border-border">
                  <td className="py-1.5 pr-3 text-text-dark">{l}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1.5 pr-3">
                      {format(s.values[i]!)}
                    </td>
                  ))}
                  {detail && <td className="py-1.5 pr-3">{detail(i) ?? '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
