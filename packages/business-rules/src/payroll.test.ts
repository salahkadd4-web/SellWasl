import { describe, expect, it } from 'vitest';
import {
  advanceRemaining,
  incentiveAmount,
  installments,
  payTotals,
  periodOf,
  scheduleError,
} from './payroll';

describe('paie', () => {
  describe('calendrier de paiement', () => {
    it('accepte 15 → 50 % et 30 → 50 %, ou 30 → 100 %', () => {
      expect(
        scheduleError([
          { day: 15, percent: 50 },
          { day: 30, percent: 50 },
        ]),
      ).toBeNull();
      expect(scheduleError([{ day: 30, percent: 100 }])).toBeNull();
    });

    it('refuse une somme différente de 100 %, des jours en désordre ou en double', () => {
      expect(
        scheduleError([
          { day: 15, percent: 40 },
          { day: 30, percent: 40 },
        ]),
      ).toContain('100');
      expect(
        scheduleError([
          { day: 30, percent: 50 },
          { day: 15, percent: 50 },
        ]),
      ).not.toBeNull();
      expect(
        scheduleError([
          { day: 15, percent: 50 },
          { day: 15, percent: 50 },
        ]),
      ).not.toBeNull();
      expect(scheduleError([])).not.toBeNull();
    });

    it("échéances : net × pourcentage, la dernière absorbe l'arrondi, jour borné à la fin du mois", () => {
      const schedule = [
        { day: 15, percent: 50 },
        { day: 30, percent: 50 },
      ];
      expect(installments(49_600, schedule, '2027-08')).toEqual([
        { installment: 1, dueDate: '2027-08-15', percent: 50, amount: 24_800 },
        { installment: 2, dueDate: '2027-08-30', percent: 50, amount: 24_800 },
      ]);
      const thirds = installments(
        100,
        [
          { day: 10, percent: 33 },
          { day: 20, percent: 33 },
          { day: 31, percent: 34 },
        ],
        '2027-02',
      );
      expect(thirds.map((i) => i.amount)).toEqual([33, 33, 34]);
      expect(thirds[2]!.dueDate).toBe('2027-02-28');
    });
  });

  describe('primes', () => {
    it('par unité : 120 cartons × 20 DA = 2 400 DA', () => {
      expect(
        incentiveAmount({ kind: 'PER_UNIT', amount: 20 }, { quantity: 120, revenue: 0 }),
      ).toEqual({ amount: 2400, unitAmount: 20 });
    });

    it('pourcentage du CA : 2 % de 150 000 DA', () => {
      expect(
        incentiveAmount(
          { kind: 'PERCENT_REVENUE', percentBp: 200 },
          { quantity: 0, revenue: 150_000 },
        ),
      ).toEqual({ amount: 3000, unitAmount: null });
    });

    it('seuil : 2 000 DA à partir de 100 cartons, rien en dessous', () => {
      const rule = { kind: 'THRESHOLD' as const, amount: 2000, threshold: 100 };
      expect(incentiveAmount(rule, { quantity: 100, revenue: 0 }).amount).toBe(2000);
      expect(incentiveAmount(rule, { quantity: 99, revenue: 0 }).amount).toBe(0);
    });

    it('paliers : 0–49 → 0, 50–99 → 10 DA, 100+ → 20 DA par carton', () => {
      const rule = {
        kind: 'TIERED' as const,
        tiers: [
          { minQty: 0, unitAmount: 0 },
          { minQty: 50, unitAmount: 10 },
          { minQty: 100, unitAmount: 20 },
        ],
      };
      expect(incentiveAmount(rule, { quantity: 40, revenue: 0 })).toEqual({
        amount: 0,
        unitAmount: 0,
      });
      expect(incentiveAmount(rule, { quantity: 60, revenue: 0 })).toEqual({
        amount: 600,
        unitAmount: 10,
      });
      expect(incentiveAmount(rule, { quantity: 120, revenue: 0 })).toEqual({
        amount: 2400,
        unitAmount: 20,
      });
    });

    it('objectif de CA : 10 000 DA si le CA atteint 1 000 000 DA', () => {
      const rule = { kind: 'REVENUE_TARGET' as const, amount: 10_000, threshold: 1_000_000 };
      expect(incentiveAmount(rule, { quantity: 0, revenue: 1_000_000 }).amount).toBe(10_000);
      expect(incentiveAmount(rule, { quantity: 0, revenue: 999_999 }).amount).toBe(0);
    });
  });

  describe('net à payer', () => {
    const base = { kind: 'BASE_SALARY' as const, amount: 60_000 };
    it('acompte : 60 000 − 10 000 = 50 000', () => {
      expect(payTotals([base, { kind: 'ADVANCE', amount: -10_000 }]).net).toBe(50_000);
    });

    it('retenue : 60 000 − 2 000 = 58 000', () => {
      expect(payTotals([base, { kind: 'DEDUCTION', amount: -2000 }]).net).toBe(58_000);
    });

    it('cas combiné : 60 000 + 2 400 − 10 000 − 2 000 = 50 400', () => {
      expect(
        payTotals([
          base,
          { kind: 'INCENTIVE', amount: 2400 },
          { kind: 'ADVANCE', amount: -10_000 },
          { kind: 'DEDUCTION', amount: -2000 },
        ]),
      ).toEqual({
        baseSalary: 60_000,
        earnings: 2400,
        advances: 10_000,
        deductions: 2000,
        net: 50_400,
      });
    });

    it('un ajustement négatif est une déduction, un positif un gain', () => {
      expect(
        payTotals([
          base,
          { kind: 'ADJUSTMENT', amount: 500 },
          { kind: 'ADJUSTMENT', amount: -300 },
        ]),
      ).toMatchObject({ earnings: 500, deductions: 300, net: 60_200 });
    });
  });

  it('période : semaine commençant le samedi, ou mois', () => {
    expect(periodOf('2027-08-11', 'WEEKLY', 'SAT')).toEqual({
      start: '2027-08-07',
      end: '2027-08-13',
    });
    expect(periodOf('2027-08-07', 'WEEKLY', 'SAT')).toEqual({
      start: '2027-08-07',
      end: '2027-08-13',
    });
    expect(periodOf('2027-08-11', 'WEEKLY', 'MON')).toEqual({
      start: '2027-08-09',
      end: '2027-08-15',
    });
    expect(periodOf('2027-02-11', 'MONTHLY', 'SAT')).toEqual({
      start: '2027-02-01',
      end: '2027-02-28',
    });
  });

  it('acompte : reste disponible selon le plafond du salaire', () => {
    expect(advanceRemaining({ baseSalary: 60_000, maxPercent: 50, alreadyRequested: 10_000 })).toBe(
      20_000,
    );
    expect(advanceRemaining({ baseSalary: 60_000, maxPercent: 50, alreadyRequested: 40_000 })).toBe(
      0,
    );
  });
});
