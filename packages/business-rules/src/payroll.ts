// Paie interne, primes, acomptes et retenues (phase 21 bis) : calculs purs, montants en DA entiers
import type { WeekdayCode } from './planning';

/** Échéance du calendrier de paiement de l'entreprise : jour du mois et part du net. */
export interface ScheduleItem {
  day: number;
  percent: number;
}

/** Message d'erreur d'un calendrier, ou null s'il est valable (somme 100 %, jours croissants). */
export function scheduleError(schedule: readonly ScheduleItem[]): string | null {
  if (schedule.length === 0) return 'Ajoutez au moins une échéance.';
  for (const [i, s] of schedule.entries()) {
    if (!Number.isInteger(s.day) || s.day < 1 || s.day > 31)
      return 'Le jour de paiement va de 1 à 31.';
    if (!Number.isInteger(s.percent) || s.percent < 1 || s.percent > 100)
      return 'La part de chaque échéance va de 1 à 100 %.';
    if (i > 0 && s.day <= schedule[i - 1]!.day)
      return 'Les jours de paiement doivent être croissants et différents.';
  }
  const total = schedule.reduce((sum, s) => sum + s.percent, 0);
  return total === 100 ? null : `Les échéances doivent faire 100 % du net (ici ${total} %).`;
}

const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};

/**
 * Échéances d'un net : net × pourcentage arrondi à l'unité inférieure, la dernière absorbe
 * l'arrondi ; un jour au-delà de la fin du mois devient le dernier jour.
 */
export function installments(
  net: number,
  schedule: readonly ScheduleItem[],
  month: string,
): { installment: number; dueDate: string; percent: number; amount: number }[] {
  const end = lastDay(month);
  let paid = 0;
  return schedule.map((s, i) => {
    const amount = i === schedule.length - 1 ? net - paid : Math.floor((net * s.percent) / 100);
    paid += amount;
    return {
      installment: i + 1,
      dueDate: `${month}-${String(Math.min(s.day, end)).padStart(2, '0')}`,
      percent: s.percent,
      amount,
    };
  });
}

export type IncentiveKindCode =
  'PER_UNIT' | 'PERCENT_REVENUE' | 'THRESHOLD' | 'TIERED' | 'REVENUE_TARGET';

export interface IncentiveRuleShape {
  kind: IncentiveKindCode;
  /** DA par unité (PER_UNIT) ou prime fixe (THRESHOLD, REVENUE_TARGET). */
  amount?: number | null;
  /** Centièmes de pourcent (200 = 2 %). */
  percentBp?: number | null;
  /** Quantité (THRESHOLD) ou chiffre d'affaires (REVENUE_TARGET). */
  threshold?: number | null;
  /** Paliers croissants : montant par unité dès `minQty`. */
  tiers?: readonly { minQty: number; unitAmount: number }[] | null;
}

/** Prime d'une règle pour une quantité vendue (unité de la règle) et un chiffre d'affaires. */
export function incentiveAmount(
  rule: IncentiveRuleShape,
  sold: { quantity: number; revenue: number },
): { amount: number; unitAmount: number | null } {
  switch (rule.kind) {
    case 'PER_UNIT':
      return { amount: sold.quantity * (rule.amount ?? 0), unitAmount: rule.amount ?? 0 };
    case 'PERCENT_REVENUE':
      return {
        amount: Math.floor((sold.revenue * (rule.percentBp ?? 0)) / 10_000),
        unitAmount: null,
      };
    case 'THRESHOLD':
      return {
        amount: sold.quantity >= (rule.threshold ?? Infinity) ? (rule.amount ?? 0) : 0,
        unitAmount: null,
      };
    case 'REVENUE_TARGET':
      return {
        amount: sold.revenue >= (rule.threshold ?? Infinity) ? (rule.amount ?? 0) : 0,
        unitAmount: null,
      };
    case 'TIERED': {
      const tier = [...(rule.tiers ?? [])]
        .sort((a, b) => b.minQty - a.minQty)
        .find((t) => sold.quantity >= t.minQty);
      const unitAmount = tier?.unitAmount ?? 0;
      return { amount: sold.quantity * unitAmount, unitAmount };
    }
  }
}

export type PayLineKind =
  | 'BASE_SALARY'
  | 'INCENTIVE'
  | 'OBJECTIVE_BONUS'
  | 'DRIVER_BONUS'
  | 'ADJUSTMENT'
  | 'ADVANCE'
  | 'DEDUCTION';

/**
 * Totaux d'une fiche de paie à partir de ses lignes signées : salaire de base, gains (primes,
 * objectifs, ajustements positifs), acomptes, retenues (et ajustements négatifs), net.
 */
export function payTotals(lines: readonly { kind: PayLineKind; amount: number }[]): {
  baseSalary: number;
  earnings: number;
  advances: number;
  deductions: number;
  net: number;
} {
  let baseSalary = 0;
  let earnings = 0;
  let advances = 0;
  let deductions = 0;
  for (const l of lines) {
    if (l.kind === 'BASE_SALARY') baseSalary += l.amount;
    else if (l.kind === 'ADVANCE') advances += -l.amount;
    else if (l.kind === 'DEDUCTION') deductions += -l.amount;
    else if (l.amount >= 0) earnings += l.amount;
    else deductions += -l.amount;
  }
  return {
    baseSalary,
    earnings,
    advances,
    deductions,
    net: baseSalary + earnings - advances - deductions,
  };
}

const WEEKDAY_INDEX: Record<WeekdayCode, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Période (semaine commençant au jour choisi, ou mois) qui contient une date AAAA-MM-JJ. */
export function periodOf(
  date: string,
  frequency: 'WEEKLY' | 'MONTHLY',
  weekStartsOn: WeekdayCode,
): { start: string; end: string } {
  if (frequency === 'MONTHLY') {
    const month = date.slice(0, 7);
    return { start: `${month}-01`, end: `${month}-${String(lastDay(month)).padStart(2, '0')}` };
  }
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() - WEEKDAY_INDEX[weekStartsOn] + 7) % 7;
  const start = new Date(d.getTime() - back * 86_400_000);
  return { start: iso(start), end: iso(new Date(start.getTime() + 6 * 86_400_000)) };
}

/** Reste qu'un acompte peut encore prendre sur le salaire du mois (plafond en %). */
export function advanceRemaining(x: {
  baseSalary: number;
  maxPercent: number;
  alreadyRequested: number;
}): number {
  return Math.max(0, Math.floor((x.baseSalary * x.maxPercent) / 100) - x.alreadyRequested);
}
