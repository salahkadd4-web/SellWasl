/** Stock d'un entrepôt pour un article (BR-STK-02) : disponible = physique − réservé. */
export interface StockBalance {
  physical: number;
  reserved: number;
}

export type StockMoveType =
  'IN' | 'OUT' | 'TRANSFER' | 'ADJUSTMENT' | 'RESERVATION' | 'RELEASE' | 'WRITE_OFF';

export interface StockMoveShape {
  type: StockMoveType;
  qty: number;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
}

/** Solde après un mouvement, ou null s'il viole BR-STK-04 (physique ≥ 0, 0 ≤ réservé ≤ physique). */
export function applyMove(balance: StockBalance, delta: StockBalance): StockBalance | null {
  const next = {
    physical: balance.physical + delta.physical,
    reserved: balance.reserved + delta.reserved,
  };
  if (next.physical < 0 || next.reserved < 0 || next.reserved > next.physical) return null;
  return next;
}

/**
 * Effet d'un mouvement sur chaque entrepôt (BR-STK-03). Un ajustement sort de `from` (manquant)
 * ou entre dans `to` (surplus) ; la réservation et la libération ne touchent que le réservé.
 */
export function moveDeltas(move: StockMoveShape): { warehouseId: string; delta: StockBalance }[] {
  const at = (id: string | null | undefined, physical: number, reserved: number) => {
    if (!id) throw new Error(`Mouvement ${move.type} sans entrepôt`);
    return { warehouseId: id, delta: { physical, reserved } };
  };
  switch (move.type) {
    case 'IN':
      return [at(move.toWarehouseId, move.qty, 0)];
    case 'OUT':
    case 'WRITE_OFF':
      return [at(move.fromWarehouseId, -move.qty, 0)];
    case 'TRANSFER':
      return [at(move.fromWarehouseId, -move.qty, 0), at(move.toWarehouseId, move.qty, 0)];
    case 'ADJUSTMENT':
      return move.fromWarehouseId
        ? [at(move.fromWarehouseId, -move.qty, 0)]
        : [at(move.toWarehouseId, move.qty, 0)];
    case 'RESERVATION':
      return [at(move.toWarehouseId, 0, move.qty)];
    case 'RELEASE':
      return [at(move.fromWarehouseId, 0, -move.qty)];
  }
}

/**
 * Ligne de déchargement (BR-STK-07) : chargé = théorique + livré ou vendu + offert ;
 * écart = compté − théorique (positif : surplus, négatif : manquant).
 */
export function unloadLine(x: {
  theoretical: number;
  delivered: number;
  free: number;
  counted: number;
}): { loaded: number; gap: number } {
  return { loaded: x.theoretical + x.delivered + x.free, gap: x.counted - x.theoretical };
}

/** Réservations à libérer quand le compté passe sous le réservé : commandes les plus récentes d'abord. */
export function releaseNewestFirst<T extends { confirmedAt: Date; reservedQty: number }>(
  lines: T[],
  shortfall: number,
): { line: T; release: number }[] {
  const result: { line: T; release: number }[] = [];
  let rest = shortfall;
  const newestFirst = [...lines].sort((a, b) => b.confirmedAt.getTime() - a.confirmedAt.getTime());
  for (const line of newestFirst) {
    if (rest <= 0) break;
    const release = Math.min(rest, line.reservedQty);
    if (release > 0) result.push({ line, release });
    rest -= release;
  }
  return result;
}

/** Stock faible : disponible sous le seuil de l'article, s'il en a un. */
export const isLowStock = (available: number, threshold: number | null): boolean =>
  threshold !== null && available < threshold;
