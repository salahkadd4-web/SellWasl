/** Ce qui empêche de lancer la préparation d'une tournée (BR-PRE-01, BR-PRE-02). */
export type LaunchBlocker =
  'WORKDAY_IN_PROGRESS' | 'PENDING_SYNC' | 'PENDING_LINES' | 'NO_DRIVER' | 'NO_TRUCK';

/**
 * Bloquants d'un lancement : journée d'un vendeur des secteurs encore en cours, téléphone qui
 * signale des opérations non envoyées, lignes en attente non traitées, secteur sans livreur,
 * livreur sans camion. Une journée jamais démarrée ne bloque pas.
 */
export function launchBlockers(x: {
  inProgressWorkdays: number;
  pendingSyncDevices: number;
  pendingLines: number;
  hasDriver: boolean;
  hasTruck: boolean;
}): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];
  if (x.inProgressWorkdays > 0) blockers.push('WORKDAY_IN_PROGRESS');
  if (x.pendingSyncDevices > 0) blockers.push('PENDING_SYNC');
  if (x.pendingLines > 0) blockers.push('PENDING_LINES');
  if (!x.hasDriver) blockers.push('NO_DRIVER');
  if (!x.hasTruck) blockers.push('NO_TRUCK');
  return blockers;
}

/** Quantité préparée proposée : unités entières de la ligne couvertes par sa réservation. */
export const defaultPrepared = (reservedQty: number, unitBaseQty: number): number =>
  Math.floor(reservedQty / unitBaseQty);

/** Un bonus recalculé ne dépasse jamais ce qui a été préparé pour lui (BR-CAT-10). */
export const capBonus = (recomputed: number, prepared: number): number =>
  Math.min(recomputed, prepared);
