import {
  type CartLineInput,
  type PricedCart,
  priceCart,
  splitByQuota,
} from '@sellwasl/business-rules';
import type { OrderLineDto, VisitCatalog } from '@sellwasl/validation';
import { useMemo, useState } from 'react';

/** Un produit du panier : l'unité choisie et une quantité par parfum (BR-CAT-16). */
export interface CartEntry {
  productId: string;
  unitId: string;
  qtyByVariant: Record<string, number>;
}

/** Panier pré-rempli à partir des lignes d'une commande à modifier (lignes normales et en attente). */
export function entriesFromOrder(lines: OrderLineDto[]): CartEntry[] {
  const byProduct = new Map<string, CartEntry>();
  for (const l of lines) {
    // Une ligne en attente acceptée est déjà dans la ligne normale ; refusée, elle n'est plus voulue
    if (l.kind === 'BONUS' || (l.kind === 'PENDING' && l.pendingStatus !== 'TO_PROCESS')) continue;
    const entry = byProduct.get(l.productId) ?? {
      productId: l.productId,
      unitId: l.unitId,
      qtyByVariant: {},
    };
    entry.qtyByVariant[l.variantId] = (entry.qtyByVariant[l.variantId] ?? 0) + l.enteredQty;
    byProduct.set(l.productId, entry);
  }
  return [...byProduct.values()];
}

/**
 * Panier de la visite, calculé sur le téléphone avec la grille du client (`priceCart`, BR-CAT-04
 * à 09). Le serveur recalcule et fige à la confirmation : son résultat fait foi.
 */
export function useCart(catalog: VisitCatalog | null, initial: CartEntry[] = []) {
  const [entries, setEntries] = useState<CartEntry[]>(initial);
  const [freeChoices, setFreeChoices] = useState<Record<string, string>>({});

  const lines: CartLineInput[] = useMemo(
    () =>
      entries.flatMap((e) =>
        Object.entries(e.qtyByVariant)
          .filter(([, qty]) => qty > 0)
          .map(([variantId, qty]) => ({ variantId, unitId: e.unitId, qty })),
      ),
    [entries],
  );

  const priced: PricedCart | null = useMemo(() => {
    if (!catalog || lines.length === 0) return null;
    return priceCart(catalog.catalog, lines, {
      customerTypeId: catalog.customerTypeId,
      date: catalog.date,
      freeVariantChoices: new Map(Object.entries(freeChoices)),
    });
  }, [catalog, lines, freeChoices]);

  /** Quantité estimée en attente par article, avec le quota restant connu (BR-QUO-03). */
  const pending = useMemo(() => {
    const result = new Map<string, number>();
    if (!catalog) return result;
    for (const l of lines) {
      const product = catalog.products.find((p) => p.variants.some((v) => v.id === l.variantId));
      const variant = product?.variants.find((v) => v.id === l.variantId);
      const unit = product?.units.find((u) => u.id === l.unitId);
      if (!variant || !unit) continue;
      const split = splitByQuota(l.qty, unit.baseQty, variant.quotaRemaining);
      if (split.pending > 0) result.set(l.variantId, split.pending);
    }
    return result;
  }, [catalog, lines]);

  return {
    entries,
    lines,
    priced,
    pending,
    freeChoices,
    /** Ajoute ou remplace un produit du panier. */
    put: (entry: CartEntry) =>
      setEntries((current) => [...current.filter((e) => e.productId !== entry.productId), entry]),
    remove: (productId: string) =>
      setEntries((current) => current.filter((e) => e.productId !== productId)),
    setFreeChoice: (ruleId: string, variantId: string) =>
      setFreeChoices((current) => ({ ...current, [ruleId]: variantId })),
  };
}
