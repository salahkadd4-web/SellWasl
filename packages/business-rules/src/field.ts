// Journée du vendeur sur le terrain : compteurs de visites, objectifs, numéros de reçus.

/**
 * Compteurs du tableau de bord (BR-VIS-06 à BR-VIS-08) : x clients du jour visités sur N, et k
 * clients hors programme. Un client visité plusieurs fois ne compte qu'une fois.
 */
export function visitCounters(
  dayCustomerIds: readonly string[],
  visits: readonly { customerId: string; status: string }[],
): { visited: number; planned: number; outOfProgram: number } {
  const day = new Set(dayCustomerIds);
  const done = new Set(visits.filter((v) => v.status === 'COMPLETED').map((v) => v.customerId));
  let visited = 0;
  let outOfProgram = 0;
  for (const id of done) {
    if (day.has(id)) visited += 1;
    else outOfProgram += 1;
  }
  return { visited, planned: day.size, outOfProgram };
}

/**
 * Objectif du mois (BR-OBJ-03) : taux = réalisé ÷ cible (en %, une décimale) ;
 * prime estimée = prime × min(taux, plafond), arrondie au dinar. Plafond null : pas de plafond.
 */
export function objectiveProgress(o: {
  targetAmount: number;
  realizedAmount: number;
  bonusAmount: number;
  capPercent: number | null;
}): { rate: number; estimatedBonus: number } {
  if (o.targetAmount <= 0) return { rate: 0, estimatedBonus: 0 };
  const ratio = o.realizedAmount / o.targetAmount;
  return {
    rate: Math.round(ratio * 1000) / 10,
    estimatedBonus: Math.round(
      o.bonusAmount * (o.capPercent === null ? ratio : Math.min(ratio, o.capPercent / 100)),
    ),
  };
}

/** Numéro de reçu ou de bon (ARC-11) : code de l'utilisateur, série de l'appareil, séquence. */
export function paymentNumber(userCode: string, series: string, sequence: number): string {
  return `${userCode}-${series}${String(sequence).padStart(4, '0')}`;
}
