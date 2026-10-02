// BR-CAT-02 : les quantités sont converties en unité de base.

export interface UnitLike {
  /** Nombre d'unités de base contenues dans cette unité (1 pour l'unité de base). */
  baseQty: number;
}

export function toBaseQty(enteredQty: number, unit: UnitLike): number {
  if (!Number.isInteger(enteredQty) || enteredQty < 0) {
    throw new RangeError(`Quantité invalide : ${enteredQty}`);
  }
  return enteredQty * unit.baseQty;
}
