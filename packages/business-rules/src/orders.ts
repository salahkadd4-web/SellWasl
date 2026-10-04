// Commandes de prévente : statuts (BR-CMD-02), quotas (BR-QUO-03), date de livraison (BR-CMD-05).
import { addDaysTo, type WeekdayCode, weekdayOf } from './planning';

export type OrderStatusCode =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'LOCKED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'PARTIALLY_DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

const TRANSITIONS: Record<OrderStatusCode, readonly OrderStatusCode[]> = {
  DRAFT: ['CONFIRMED'],
  CONFIRMED: ['LOCKED', 'CANCELLED'],
  // Réouverture de la journée, ou lancement de la préparation
  LOCKED: ['CONFIRMED', 'PREPARING'],
  PREPARING: ['READY'],
  READY: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED'],
  DELIVERED: [],
  PARTIALLY_DELIVERED: [],
  // Reprogrammation d'une livraison échouée (BR-LIV-06)
  FAILED: ['LOCKED'],
  CANCELLED: [],
};

/** Passage permis d'un statut de commande à un autre (BR-CMD-02). */
export function canTransition(from: OrderStatusCode, to: OrderStatusCode): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Scission d'une ligne au quota (BR-QUO-03), dans l'unité saisie : la partie couverte par le reste
 * du quota (en unité de base) reste normale, l'excédent part en attente. Sans quota, rien n'est
 * scindé ; une unité incomplète du reste n'est pas couverte.
 */
export function splitByQuota(
  qty: number,
  unitBaseQty: number,
  remainingBase: number | null,
): { normal: number; pending: number } {
  if (remainingBase === null) return { normal: qty, pending: 0 };
  const covered = Math.max(0, Math.floor(remainingBase / unitBaseQty));
  const normal = Math.min(qty, covered);
  return { normal, pending: qty - normal };
}

/** Date de livraison prévue : premier jour suivant ni chômé ni férié (BR-CMD-05). */
export function nextWorkingDay(
  date: string,
  calendar: { workingDays: readonly WeekdayCode[]; holidays: readonly string[] },
): string {
  let next = addDaysTo(date, 1);
  for (let i = 0; i < 366; i += 1) {
    if (calendar.workingDays.includes(weekdayOf(next)) && !calendar.holidays.includes(next))
      return next;
    next = addDaysTo(next, 1);
  }
  return next;
}
