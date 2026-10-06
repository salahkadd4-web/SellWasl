import {
  type CartLineInput,
  priceCart,
  type PricingCatalog,
  splitByQuota,
} from '@sellwasl/business-rules';
import type { OrderLineDto } from '@sellwasl/validation';
import type { LocalState } from './local-state';

/** Action impossible avec les données du téléphone : message pour l'utilisateur. */
export class OfflineError extends Error {}

/** Commandes qui consomment le quota du jour (comme le serveur, BR-QUO-03). */
const QUOTA_STATUSES = new Set([
  'CONFIRMED',
  'LOCKED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
]);

/** Quantités qui consomment le quota ce jour-là, par article, en unité de base (P-03 : bonus). */
export function consumedQuota(
  s: LocalState,
  date: string,
  bonusConsumesQuota: boolean,
  excludeOrderId?: string,
): Map<string, number> {
  const consumed = new Map<string, number>();
  for (const o of s.orders.values()) {
    if (o.orderDate !== date || !QUOTA_STATUSES.has(o.status) || o.id === excludeOrderId) continue;
    for (const l of o.lines) {
      if (l.kind !== 'NORMAL' && !(bonusConsumesQuota && l.kind === 'BONUS')) continue;
      consumed.set(l.variantId, (consumed.get(l.variantId) ?? 0) + l.orderedQty);
    }
  }
  return consumed;
}

/** Quota restant d'un article ce jour-là (unité de base) ; null : pas de quota. */
export function quotaRemaining(
  s: LocalState,
  date: string,
  variantId: string,
  consumed: Map<string, number>,
): number | null {
  const quota = s.quotas.find((q) => q.date === date && q.variantId === variantId);
  return quota ? quota.qty - (consumed.get(variantId) ?? 0) : null;
}

export interface BuildInput {
  customerTypeId: string;
  date: string;
  lines: CartLineInput[];
  freeVariantChoices?: Record<string, string>;
  /** Commande modifiée : ses propres lignes ne consomment pas le quota. */
  excludeOrderId?: string;
  /** Vente cash van : stock du camion, sans réservation au dépôt. */
  cashVan: boolean;
}

export interface BuiltOrder {
  lines: OrderLineDto[];
  /** Découpage envoyé au serveur (en unité de base), pour qu'il signale ses différences. */
  expected: { variantId: string; pendingQty: number; stockoutQty: number }[];
  totalAmount: number;
}

/**
 * Panier calculé sur le téléphone comme sur le serveur (`OrderService.build`, BR-CAT-04 à 09,
 * BR-QUO-03) : prix et paliers, scission au quota, bonus sur les quantités confirmées, réservation
 * du disponible connu du dépôt. Le serveur recalcule à la réception et signale ce qui diffère.
 */
export function buildOrder(s: LocalState, input: BuildInput): BuiltOrder {
  const catalog = s.pricing.get(input.customerTypeId) as PricingCatalog | undefined;
  if (!catalog) throw new OfflineError('Grille de prix absente : synchronisez le téléphone.');
  const available = input.cashVan
    ? new Map([...s.truckStock.values()].map((t) => [t.variantId, t.qty]))
    : new Map(s.depotStock);
  const context = {
    customerTypeId: input.customerTypeId,
    date: input.date,
    availableStock: available,
    freeVariantChoices: new Map(Object.entries(input.freeVariantChoices ?? {})),
  };
  const full = priceCart(catalog, input.lines, context);
  if (full.unpriced.length > 0)
    throw new OfflineError('Article non proposable à ce client (pas de prix pour son type).');

  const P03 = s.settings?.rules.P03_bonusConsumesQuota ?? false;
  const consumed = consumedQuota(s, input.date, P03, input.excludeOrderId);
  const unitBase = (unitId: string) => catalog.units.find((u) => u.id === unitId)!.baseQty;

  type Built = {
    kind: OrderLineDto['kind'];
    productId: string;
    variantId: string;
    unitId: string;
    qty: number;
    baseQty: number;
    unitPrice: number;
  };
  const built: Built[] = [];
  for (const l of full.lines) {
    const split = splitByQuota(
      l.qty,
      unitBase(l.unitId),
      quotaRemaining(s, input.date, l.variantId, consumed),
    );
    const base = {
      productId: l.productId,
      variantId: l.variantId,
      unitId: l.unitId,
      unitPrice: l.unitPrice,
    };
    if (split.normal > 0)
      built.push({
        ...base,
        kind: 'NORMAL',
        qty: split.normal,
        baseQty: split.normal * unitBase(l.unitId),
      });
    if (split.pending > 0)
      built.push({
        ...base,
        kind: 'PENDING',
        qty: split.pending,
        baseQty: split.pending * unitBase(l.unitId),
      });
  }
  // Bonus sur les quantités confirmées seulement
  const confirmed = priceCart(
    catalog,
    built
      .filter((l) => l.kind === 'NORMAL')
      .map((l) => ({ variantId: l.variantId, unitId: l.unitId, qty: l.qty })),
    context,
  );
  for (const f of confirmed.freeLines)
    if (f.qty > 0)
      built.push({
        kind: 'BONUS',
        productId: f.productId,
        variantId: f.variantId,
        unitId: f.unitId,
        qty: f.qty,
        baseQty: f.qty * unitBase(f.unitId),
        unitPrice: 0,
      });

  // Réservation du disponible (prévente) ; en cash van, la vente part du camion
  const left = new Map(available);
  const lines: OrderLineDto[] = built.map((l, i) => {
    let reserved = 0;
    if (l.kind !== 'PENDING') {
      reserved = input.cashVan
        ? l.baseQty
        : Math.max(0, Math.min(l.baseQty, left.get(l.variantId) ?? 0));
      left.set(l.variantId, (left.get(l.variantId) ?? 0) - reserved);
    }
    const product = s.products.find((p) => p.id === l.productId);
    const variant = product?.variants.find((v) => v.id === l.variantId);
    return {
      id: `local-${i}`,
      kind: l.kind,
      pendingStatus: l.kind === 'PENDING' ? 'TO_PROCESS' : null,
      productId: l.productId,
      variantId: l.variantId,
      unitId: l.unitId,
      productName: product?.name ?? '',
      variantName: variant && !variant.isDefault ? variant.name : null,
      unitName: product?.units.find((u) => u.id === l.unitId)?.name ?? '',
      enteredQty: l.qty,
      orderedQty: l.baseQty,
      reservedQty: reserved,
      unitPrice: l.unitPrice,
      lineAmount: l.unitPrice * l.qty,
      isStockout: l.kind !== 'PENDING' && reserved < l.baseQty,
    };
  });

  const byVariant = new Map<string, { pendingQty: number; stockoutQty: number }>();
  for (const l of lines) {
    const e = byVariant.get(l.variantId) ?? { pendingQty: 0, stockoutQty: 0 };
    if (l.kind === 'PENDING') e.pendingQty += l.orderedQty;
    else e.stockoutQty += l.orderedQty - l.reservedQty;
    byVariant.set(l.variantId, e);
  }
  return {
    lines,
    expected: [...byVariant]
      .filter(([, e]) => e.pendingQty > 0 || e.stockoutQty > 0)
      .map(([variantId, e]) => ({ variantId, ...e })),
    totalAmount: lines
      .filter((l) => l.kind === 'NORMAL')
      .reduce((n, l) => n + l.unitPrice * l.enteredQty, 0),
  };
}
