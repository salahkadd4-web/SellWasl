/**
 * Objectif du jour (BR-OBJ-06, BR-OBJ-07) : une quantité d'un produit par jour, une prime par
 * jour, un plafond et un minimum facultatifs ; chaque jour compte à part, la semaine en fait la
 * somme (payée en fin de semaine).
 */
export interface DailyObjectiveShape {
  /** Cible du jour, dans l'unité de l'objectif. */
  dailyTarget: number;
  /** Prime d'un jour où la cible est atteinte, en DA. */
  bonusAmount: number;
  /** Plafond en % ; null : pas de plafond. */
  capPercent: number | null;
  /** Minimum du jour : en dessous, le jour ne rapporte rien ; null : pas de minimum. */
  minQty: number | null;
}

/** Prime d'un jour : 0 sous le minimum, sinon prime × min(réalisé ÷ cible, plafond), au dinar. */
function dayAmount(o: DailyObjectiveShape, qty: number): number {
  if (o.dailyTarget <= 0) return 0;
  if (o.minQty !== null && qty < o.minQty) return 0;
  const ratio = qty / o.dailyTarget;
  return Math.round(
    o.bonusAmount * (o.capPercent === null ? ratio : Math.min(ratio, o.capPercent / 100)),
  );
}

/** Prime de la semaine : somme des jours, avec le détail de chaque jour. */
export function dailyObjectiveAmount(
  o: DailyObjectiveShape,
  days: readonly { date: string; qty: number }[],
): { amount: number; quantity: number; days: { date: string; qty: number; amount: number }[] } {
  const detail = days.map((d) => ({ date: d.date, qty: d.qty, amount: dayAmount(o, d.qty) }));
  return {
    amount: detail.reduce((sum, d) => sum + d.amount, 0),
    quantity: detail.reduce((sum, d) => sum + d.qty, 0),
    days: detail,
  };
}
