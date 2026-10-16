// Pas de temps des courbes de la page Statistiques (ventes et retours dans le temps)
import { periodOf } from './payroll';
import type { WeekdayCode } from './planning';

export const TREND_UNITS = ['DAY', 'WEEK', 'MONTH'] as const;
export type TrendUnit = (typeof TREND_UNITS)[number];

const DAY_MS = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Jour jusqu'à 62 jours, semaine jusqu'à 183, mois au-delà : une courbe lisible à toute échelle. */
export function trendUnit(from: string, to: string): TrendUnit {
  const days = (at(to) - at(from)) / DAY_MS + 1;
  if (days <= 62) return 'DAY';
  if (days <= 183) return 'WEEK';
  return 'MONTH';
}

/** Début de la période (jour, semaine commençant au jour choisi, mois) qui contient une date. */
export function trendStart(date: string, unit: TrendUnit, weekStartsOn: WeekdayCode): string {
  if (unit === 'DAY') return date;
  return periodOf(date, unit === 'WEEK' ? 'WEEKLY' : 'MONTHLY', weekStartsOn).start;
}

/** Début de chaque période de `from` à `to`, vides comprises, dans l'ordre. */
export function trendStarts(
  from: string,
  to: string,
  unit: TrendUnit,
  weekStartsOn: WeekdayCode,
): string[] {
  const starts: string[] = [];
  let current = trendStart(from, unit, weekStartsOn);
  while (current <= to) {
    starts.push(current);
    if (unit === 'DAY') current = iso(at(current) + DAY_MS);
    else if (unit === 'WEEK') current = iso(at(current) + 7 * DAY_MS);
    else {
      const [y, m] = current.split('-').map(Number) as [number, number];
      current = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    }
  }
  return starts;
}
