import { capBonus } from './preparation';
import { type PricingCatalog, priceCart } from './pricing';

export interface RepriceNormal {
  id: string;
  variantId: string;
  unitId: string;
  unitPrice: number;
  /** Quantité retenue (préparée ou livrée), dans l'unité de la ligne. */
  qty: number;
}

export interface RepriceBonus {
  id: string;
  bonusRuleId: string | null;
  variantId: string;
  /** Plafond : ce qui a été préparé pour ce bonus, dans son unité. */
  maxQty: number;
}

export interface RepriceAdded {
  variantId: string;
  unitId: string;
  qty: number;
}

export interface RepriceResult {
  /** Prix unitaire de chaque ligne normale. */
  prices: Map<string, number>;
  /** Quantité offerte de chaque ligne bonus. */
  bonus: Map<string, number>;
  /** Produits ajoutés sur une nouvelle ligne, chiffrés. */
  added: (RepriceAdded & { productId: string; unitPrice: number })[];
}

/** Ajout impossible : message pour l'utilisateur. */
export class RepriceError extends Error {}

/**
 * Prix d'une commande dont les quantités changent (BR-CAT-10) : à la préparation ou à la
 * livraison, sur le serveur comme sur le téléphone hors connexion (phase 23). Sans recalcul, les
 * prix confirmés et les bonus préparés restent ; avec recalcul, paliers et bonus suivent les
 * nouvelles quantités, avec la grille du type du client, et un bonus ne dépasse jamais ce qui a
 * été préparé pour lui.
 */
export function repriceOrder(
  catalog: PricingCatalog,
  order: { customerTypeId: string; date: string },
  normals: RepriceNormal[],
  bonuses: RepriceBonus[],
  added: RepriceAdded[],
  recalculate: boolean,
): RepriceResult {
  const prices = new Map(normals.map((l) => [l.id, l.unitPrice]));
  const bonus = new Map(bonuses.map((b) => [b.id, b.maxQty]));
  if (!recalculate && added.length === 0) return { prices, bonus, added: [] };

  // Un produit ajouté qui a déjà sa ligne l'augmente ; les autres forment de nouvelles lignes
  const qtyOf = new Map(normals.map((l) => [l.id, l.qty]));
  const fresh: RepriceAdded[] = [];
  for (const a of added) {
    const existing = normals.find((l) => l.variantId === a.variantId);
    if (!existing) fresh.push(a);
    else if (existing.unitId !== a.unitId)
      throw new RepriceError('Ajoutez ce produit dans la même unité que sa ligne de commande.');
    else qtyOf.set(existing.id, (qtyOf.get(existing.id) ?? 0) + a.qty);
  }

  const cart = priceCart(
    catalog,
    [
      ...normals.map((l) => ({ variantId: l.variantId, unitId: l.unitId, qty: qtyOf.get(l.id)! })),
      ...fresh,
    ],
    {
      customerTypeId: order.customerTypeId,
      date: order.date,
      freeVariantChoices: new Map(
        bonuses.flatMap((b) => (b.bonusRuleId ? [[b.bonusRuleId, b.variantId] as const] : [])),
      ),
    },
  );
  if (cart.unpriced.some((u) => fresh.some((f) => f.variantId === u.variantId)))
    throw new RepriceError('Article non proposable à ce client (pas de prix pour son type).');

  const priced = (variantId: string, unitId: string) =>
    cart.lines.find((p) => p.variantId === variantId && p.unitId === unitId);
  for (const l of normals) {
    const p = priced(l.variantId, l.unitId);
    if (p) prices.set(l.id, p.unitPrice);
  }
  for (const b of bonuses) {
    const recomputed =
      cart.freeLines.find((f) => f.ruleId === b.bonusRuleId && f.variantId === b.variantId)?.qty ??
      0;
    bonus.set(b.id, capBonus(recomputed, b.maxQty));
  }
  return {
    prices,
    bonus,
    added: fresh.map((a) => {
      const p = priced(a.variantId, a.unitId)!;
      return { ...a, productId: p.productId, unitPrice: p.unitPrice };
    }),
  };
}
