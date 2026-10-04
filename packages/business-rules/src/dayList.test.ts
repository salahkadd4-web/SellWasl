import { describe, expect, it } from 'vitest';
import {
  dayList,
  dayStatus,
  isCustomerDue,
  missedCustomers,
  type PlannedCustomer,
  type PlanningCalendar,
} from './planning';

// Partie 1 le samedi, …, partie 6 le jeudi ; vendredi chômé (plan, phase 14)
const calendar: PlanningCalendar = {
  workingDays: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'],
  holidays: ['2026-11-01'],
  partByWeekday: { SAT: 'P1', SUN: 'P2', MON: 'P3', TUE: 'P4', WED: 'P5', THU: 'P6' },
};
const customer = (patch: Partial<PlannedCustomer> = {}): PlannedCustomer => ({
  id: 'C1',
  partId: 'P1',
  frequency: 'WEEKLY',
  referenceDate: '2026-10-03',
  isActive: true,
  ...patch,
});

describe('clients du jour (BR-PLA-02)', () => {
  it('exemple §22 : tous les 15 jours, référence le samedi 3 octobre 2026', () => {
    const c = customer({ frequency: 'BIWEEKLY' });
    for (const d of ['2026-10-03', '2026-10-17', '2026-10-31'])
      expect(isCustomerDue(c, d, calendar)).toBe(true);
    for (const d of ['2026-10-10', '2026-10-24']) expect(isCustomerDue(c, d, calendar)).toBe(false);
  });

  it('toutes les 4 semaines, et jamais avant la date de référence', () => {
    const c = customer({ frequency: 'EVERY_4_WEEKS' });
    expect(isCustomerDue(c, '2026-10-31', calendar)).toBe(true);
    expect(isCustomerDue(c, '2026-10-17', calendar)).toBe(false);
    expect(isCustomerDue(c, '2026-09-26', calendar)).toBe(false);
  });

  it('seulement le jour de sa partie, s’il est actif et placé', () => {
    expect(isCustomerDue(customer(), '2026-10-04', calendar)).toBe(false);
    expect(isCustomerDue(customer({ isActive: false }), '2026-10-03', calendar)).toBe(false);
    expect(isCustomerDue(customer({ partId: null }), '2026-10-03', calendar)).toBe(false);
  });

  it('pas de clients les jours chômés et fériés (BR-PLA-04)', () => {
    expect(dayStatus('2026-10-09', calendar)).toEqual({ kind: 'NON_WORKING' });
    expect(dayStatus('2026-11-01', calendar)).toEqual({ kind: 'HOLIDAY' });
    // Le 1er novembre 2026 est un dimanche, jour de la partie 2
    expect(dayList([customer({ partId: 'P2' })], '2026-11-01', calendar)).toEqual([]);
  });

  it('ajoute les clients reprogrammés, sans doublon (BR-PLA-05)', () => {
    const list = dayList(
      [customer(), customer({ id: 'C2', partId: 'P3' }), customer({ id: 'C3' })],
      '2026-10-03',
      calendar,
      ['C2', 'C3'],
    );
    expect(list).toEqual([
      { customerId: 'C1', reason: 'SCHEDULED' },
      { customerId: 'C2', reason: 'RESCHEDULED' },
      { customerId: 'C3', reason: 'SCHEDULED' },
    ]);
  });

  it('les clients du jour non visités sont manqués (BR-PLA-06)', () => {
    const list = dayList([customer(), customer({ id: 'C2' })], '2026-10-03', calendar);
    expect(missedCustomers(list, ['C2'])).toEqual(['C1']);
  });
});
