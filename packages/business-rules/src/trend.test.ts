import { describe, expect, it } from 'vitest';
import { trendStart, trendStarts, trendUnit } from './trend';

/** Pas de temps des courbes de la page Statistiques. */
describe('pas de temps des courbes', () => {
  it('jour jusqu’à 62 jours, semaine jusqu’à 183, mois au-delà', () => {
    expect(trendUnit('2026-10-01', '2026-10-01')).toBe('DAY');
    expect(trendUnit('2026-10-01', '2026-12-01')).toBe('DAY'); // 62 jours
    expect(trendUnit('2026-10-01', '2026-12-02')).toBe('WEEK'); // 63 jours
    expect(trendUnit('2026-01-01', '2026-07-02')).toBe('WEEK'); // 183 jours
    expect(trendUnit('2026-01-01', '2026-07-03')).toBe('MONTH'); // 184 jours
  });

  it('début de la période qui contient une date', () => {
    // 2026-10-15 est un jeudi : la semaine commence le samedi 10
    expect(trendStart('2026-10-15', 'DAY', 'SAT')).toBe('2026-10-15');
    expect(trendStart('2026-10-15', 'WEEK', 'SAT')).toBe('2026-10-10');
    expect(trendStart('2026-10-17', 'WEEK', 'SAT')).toBe('2026-10-17');
    expect(trendStart('2026-10-15', 'WEEK', 'MON')).toBe('2026-10-12');
    expect(trendStart('2026-10-15', 'MONTH', 'SAT')).toBe('2026-10-01');
  });

  it('toutes les périodes, vides comprises, dans l’ordre', () => {
    expect(trendStarts('2026-10-01', '2026-10-03', 'DAY', 'SAT')).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    expect(trendStarts('2026-10-01', '2026-10-20', 'WEEK', 'SAT')).toEqual([
      '2026-09-26',
      '2026-10-03',
      '2026-10-10',
      '2026-10-17',
    ]);
    expect(trendStarts('2026-01-15', '2026-04-02', 'MONTH', 'SAT')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
    // Passage d'année
    expect(trendStarts('2026-12-20', '2027-01-05', 'MONTH', 'SAT')).toEqual([
      '2026-12-01',
      '2027-01-01',
    ]);
  });
});
