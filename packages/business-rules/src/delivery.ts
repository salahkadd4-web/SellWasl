/**
 * Montant minimum à encaisser à la livraison (BR-PAY-03) : tout le dû sans crédit ; avec crédit,
 * la part qui dépasserait le plafond compte tenu de la dette actuelle.
 */
export function minimumCash(x: {
  due: number;
  isCreditAllowed: boolean;
  creditLimit: number;
  debt: number;
}): number {
  if (!x.isCreditAllowed) return x.due;
  const room = Math.max(0, x.creditLimit - x.debt);
  return Math.max(0, x.due - room);
}

/** Motifs d'échec qui permettent de reprogrammer la livraison (BR-LIV-06). */
const RESCHEDULABLE = ['CUSTOMER_ABSENT', 'STORE_CLOSED', 'NOT_DELIVERED'];

/** Reprogrammée une seule fois au jour ouvré suivant, si l'entreprise le veut (P-05). */
export function shouldReschedule(x: {
  reasonCode: string | null;
  attempt: number;
  rescheduleEnabled: boolean;
}): boolean {
  return (
    x.rescheduleEnabled && x.attempt === 1 && !!x.reasonCode && RESCHEDULABLE.includes(x.reasonCode)
  );
}

/** Taux de retour du livreur, en %, au dixième : retourné au déchargement ÷ chargé. */
export function returnRate(loaded: number, returned: number): number | null {
  if (loaded <= 0) return null;
  return Math.round((returned / loaded) * 1000) / 10;
}

export interface ReturnTier {
  /** Taux de retour maximum, en %. */
  maxRate: number;
  /** Part de l'objectif obtenue, en %. */
  score: number;
}

/** Score du taux de retour : premier palier dont le taux maximum est atteint, sinon 0. */
export function tierScore(rate: number | null, tiers: readonly ReturnTier[]): number {
  if (rate === null) return 0;
  const tier = [...tiers].sort((a, b) => a.maxRate - b.maxRate).find((t) => rate <= t.maxRate);
  return tier?.score ?? 0;
}

/** Score du livreur, en % : taux de retour et critères notés sur 10, pondérés (somme 100). */
export function driverScore(x: {
  returnWeight: number;
  returnScore: number;
  criteria: readonly { weight: number; rating: number }[];
}): number {
  const criteria = x.criteria.reduce((sum, c) => sum + c.weight * c.rating * 10, 0);
  return Math.round((x.returnWeight * x.returnScore + criteria) / 100);
}

/** Prime due au livreur : prime du mois × score. */
export const driverBonus = (bonusAmount: number, score: number): number =>
  Math.round((bonusAmount * score) / 100);
