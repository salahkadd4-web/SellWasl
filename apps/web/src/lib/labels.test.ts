import { describe, expect, it } from 'vitest';
import { formatDA, nextDate, shiftDate, trendLabel } from './labels';
import { idempotencyDone, idempotencyKey } from './idempotency';

describe('formats', () => {
  it('montants en dinars, sans décimales', () => {
    expect(formatDA(42000).replace(/\s/g, ' ')).toBe('42 000 DA');
    expect(formatDA(0)).toBe('0 DA');
  });

  it('libellé d’une période de courbe : jour, semaine, mois', () => {
    expect(trendLabel('2026-10-05', 'DAY')).toBe('05/10');
    expect(trendLabel('2026-10-10', 'WEEK')).toBe('sem. 10/10');
    expect(trendLabel('2026-10-01', 'MONTH')).toBe('oct. 2026');
    expect(trendLabel('2027-02-01', 'MONTH')).toBe('févr. 2027');
  });

  it('dates décalées, y compris en changeant de mois et d’année', () => {
    expect(nextDate('2026-10-31')).toBe('2026-11-01');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDate('2026-10-11', -30)).toBe('2026-09-11');
  });
});

describe('clé d’idempotence (phase 25)', () => {
  it('la même clé tant que l’action n’a pas réussi, une nouvelle ensuite', () => {
    const first = idempotencyKey('settlement:j1')['Idempotency-Key'];
    expect(idempotencyKey('settlement:j1')['Idempotency-Key']).toBe(first);
    expect(idempotencyKey('settlement:j2')['Idempotency-Key']).not.toBe(first);
    idempotencyDone('settlement:j1');
    expect(idempotencyKey('settlement:j1')['Idempotency-Key']).not.toBe(first);
  });
});
