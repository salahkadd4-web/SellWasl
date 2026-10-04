import { describe, expect, it } from 'vitest';
import { canTransition, nextWorkingDay, splitByQuota } from './orders';

describe('commandes', () => {
  it('suit la machine à états des commandes (BR-CMD-02)', () => {
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'LOCKED')).toBe(true);
    expect(canTransition('LOCKED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('LOCKED', 'CANCELLED')).toBe(false);
    expect(canTransition('FAILED', 'LOCKED')).toBe(true);
    expect(canTransition('DELIVERED', 'CONFIRMED')).toBe(false);
  });

  it('scinde au quota dans l’unité saisie (BR-QUO-03)', () => {
    expect(splitByQuota(10, 24, null)).toEqual({ normal: 10, pending: 0 });
    expect(splitByQuota(10, 24, 240)).toEqual({ normal: 10, pending: 0 });
    expect(splitByQuota(10, 24, 100)).toEqual({ normal: 4, pending: 6 });
    expect(splitByQuota(10, 24, 0)).toEqual({ normal: 0, pending: 10 });
    expect(splitByQuota(3, 1, -5)).toEqual({ normal: 0, pending: 3 });
  });

  it('livre le jour ouvré suivant (BR-CMD-05)', () => {
    const calendar = {
      workingDays: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] as const,
      holidays: ['2026-10-05'],
    };
    expect(nextWorkingDay('2026-10-08', calendar)).toBe('2026-10-10'); // jeudi → samedi
    expect(nextWorkingDay('2026-10-04', calendar)).toBe('2026-10-06'); // dimanche → mardi
  });
});
