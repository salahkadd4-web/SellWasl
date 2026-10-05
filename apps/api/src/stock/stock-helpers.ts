import type { WarehouseRef } from '@sellwasl/validation';
import { rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Nom affiché d'un article : le produit, suivi du parfum s'il y en a un. */
export const articleOf = (v: { name: string; isDefault: boolean; product: { name: string } }) => ({
  productName: v.product.name,
  variantName: v.isDefault ? null : v.name,
});

export const articleName = (v: { name: string; isDefault: boolean; product: { name: string } }) =>
  v.isDefault ? v.product.name : `${v.product.name} ${v.name}`;

export const warehouseRef = (w: {
  id: string;
  code: string;
  name: string;
  type: 'DEPOT' | 'TRUCK';
}): WarehouseRef => ({ id: w.id, code: w.code, name: w.name, type: w.type });

export const fullName = (u: { firstName: string; lastName: string }) =>
  `${u.firstName} ${u.lastName}`;

/** Entrepôt actif du type attendu (BR-STK-01). */
export async function activeWarehouse(
  tx: Pick<Tx, 'warehouse'>,
  id: string,
  type: 'DEPOT' | 'TRUCK',
) {
  const w = await tx.warehouse.findFirst({ where: { id, isActive: true, deletedAt: null } });
  if (!w || w.type !== type)
    throw rule(type === 'DEPOT' ? 'Choisissez un dépôt actif.' : 'Choisissez un camion actif.');
  return w;
}

export interface BaseLine {
  variantId: string;
  unitId: string;
  unitName: string;
  enteredQty: number;
  /** Quantité en unité de base. */
  qty: number;
  article: string;
}

/** Quantités saisies dans une unité du produit, converties en unité de base (BR-STK-02). */
export async function toBaseLines(
  tx: Pick<Tx, 'productVariant' | 'productUnit'>,
  lines: { variantId: string; unitId: string; qty: number }[],
): Promise<BaseLine[]> {
  const [variants, units] = await Promise.all([
    tx.productVariant.findMany({
      where: { id: { in: lines.map((l) => l.variantId) }, deletedAt: null },
      include: { product: true },
    }),
    tx.productUnit.findMany({ where: { id: { in: lines.map((l) => l.unitId) }, deletedAt: null } }),
  ]);
  return lines.map((l) => {
    const variant = variants.find((v) => v.id === l.variantId);
    if (!variant) throw rule('Article introuvable.');
    const unit = units.find((u) => u.id === l.unitId && u.productId === variant.productId);
    if (!unit) throw rule(`Unité inconnue pour ${articleName(variant)}.`);
    return {
      variantId: l.variantId,
      unitId: l.unitId,
      unitName: unit.name,
      enteredQty: l.qty,
      qty: l.qty * unit.baseQty,
      article: articleName(variant),
    };
  });
}

/** Début d'une journée locale de l'entreprise, en UTC. */
export function localDayStart(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

/** Bornes [début, fin[ d'une période de jours locaux. */
export function localRange(from: string, to: string, timeZone: string) {
  const end = localDayStart(to, timeZone);
  return { gte: localDayStart(from, timeZone), lt: new Date(end.getTime() + 86_400_000) };
}
