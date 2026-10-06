/** Taux d'un indicateur de retours (phase 21) ; aucune conclusion sous le volume minimum. */
export interface RateResult {
  /** Pourcentage arrondi à 0,1 ; null sous le volume minimum. */
  rate: number | null;
  /** Dénominateur du taux. */
  volume: number;
  insufficient: boolean;
}

export function rate(numerator: number, denominator: number, minVolume: number): RateResult {
  if (denominator <= 0 || denominator < minVolume)
    return { rate: null, volume: Math.max(denominator, 0), insufficient: true };
  return {
    rate: Math.round((numerator / denominator) * 1000) / 10,
    volume: denominator,
    insufficient: false,
  };
}

/** Coût net des retours : valeur retournée − valeur revendue en tournée. */
export function netReturnCost(returnedValue: number, resoldValue: number): number {
  return returnedValue - resoldValue;
}

/** Prix moyen par unité de base de lignes vendues ; null s'il n'y a aucune quantité. */
export function weightedUnitPrice(lines: { qty: number; amount: number }[]): number | null {
  const qty = lines.reduce((sum, l) => sum + l.qty, 0);
  if (qty <= 0) return null;
  return lines.reduce((sum, l) => sum + l.amount, 0) / qty;
}
