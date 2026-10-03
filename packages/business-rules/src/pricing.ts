// BR-CAT-04 à BR-CAT-07, BR-CAT-14, BR-CAT-15 : prix, paliers et bonus d'un panier.
// Calcul partagé par l'API (simulation, confirmation) et le mobile (saisie hors connexion).
// Montants en dinars entiers ; quantités entières.

export type ThresholdScopeCode = 'ALL_VARIANTS' | 'PER_VARIANT';
export type FreeVariantModeCode = 'FIXED' | 'SELLER_CHOICE' | 'AUTO_MOST_STOCK';

export interface CatalogUnit {
  id: string;
  productId: string;
  /** Nombre d'unités de base (1 pour l'unité de base). */
  baseQty: number;
}

export interface CatalogVariant {
  id: string;
  productId: string;
  isActive: boolean;
}

/** Prix du produit (`variantId` null) ou prix propre d'un parfum, pour un type de client. */
export interface CatalogPrice {
  productId: string;
  variantId: string | null;
  unitId: string;
  price: number;
}

export interface CatalogTier {
  productId: string;
  variantId: string | null;
  unitId: string;
  minQty: number;
  unitPrice: number;
  thresholdScope: ThresholdScopeCode;
}

export interface CatalogBonusRule {
  id: string;
  name: string;
  buyProductId: string;
  buyVariantId: string | null;
  buyUnitId: string;
  buyQty: number;
  freeProductId: string;
  freeVariantId: string | null;
  freeUnitId: string;
  freeQty: number;
  freeVariantMode: FreeVariantModeCode;
  /** Dates « AAAA-MM-JJ » incluses ; `validTo` null = sans fin. */
  validFrom: string;
  validTo: string | null;
  /** Types de clients visés ; vide = tous. */
  customerTypeIds: readonly string[];
}

/** Grille de prix d'un type de client : ce que le téléphone garde hors connexion. */
export interface PricingCatalog {
  units: readonly CatalogUnit[];
  variants: readonly CatalogVariant[];
  prices: readonly CatalogPrice[];
  tiers: readonly CatalogTier[];
  bonusRules: readonly CatalogBonusRule[];
}

export interface CartLineInput {
  variantId: string;
  unitId: string;
  qty: number;
}

export interface PricingContext {
  customerTypeId: string;
  /** Date de la commande, « AAAA-MM-JJ », pour la validité des bonus. */
  date: string;
  /**
   * Stock disponible par article, en unité de base : dépôt en prévente, camion en cash van
   * (BR-CAT-07). Absent : les bonus ne sont pas limités (simulation).
   */
  availableStock?: ReadonlyMap<string, number>;
  /** Parfum offert choisi par le vendeur, par règle (BR-CAT-15). */
  freeVariantChoices?: ReadonlyMap<string, string>;
}

export interface PricedLine extends CartLineInput {
  productId: string;
  /** Prix unitaire de base (produit ou parfum), avant palier. */
  basePrice: number;
  unitPrice: number;
  /** Seuil du palier appliqué, null sans palier. */
  tierMinQty: number | null;
  /** Le parfum a son propre prix (BR-CAT-14). */
  ownPrice: boolean;
  total: number;
}

export interface FreeLine {
  ruleId: string;
  ruleName: string;
  productId: string;
  variantId: string;
  unitId: string;
  /** Quantité offerte, dans l'unité de la règle. */
  qty: number;
  /** Quantité due par la règle, avant la limite du stock. */
  requestedQty: number;
  /** Réduite faute de stock (BR-CAT-07). */
  reducedForStock: boolean;
}

export interface UnpricedLine extends CartLineInput {
  reason: 'NO_PRICE' | 'INACTIVE' | 'UNKNOWN';
}

export interface PricedCart {
  lines: PricedLine[];
  freeLines: FreeLine[];
  /** Lignes sans prix pour ce type de client : l'article n'est pas proposable (BR-CAT-04). */
  unpriced: UnpricedLine[];
  total: number;
}

function inPeriod(date: string, from: string, to: string | null): boolean {
  return date >= from && (to === null || date <= to);
}

/** Calcule les prix, paliers et bonus d'un panier pour un type de client. */
export function priceCart(
  catalog: PricingCatalog,
  input: readonly CartLineInput[],
  context: PricingContext,
): PricedCart {
  const unitById = new Map(catalog.units.map((u) => [u.id, u]));
  const variantById = new Map(catalog.variants.map((v) => [v.id, v]));
  const priceOf = (productId: string, variantId: string | null, unitId: string) =>
    catalog.prices.find(
      (p) => p.productId === productId && p.variantId === variantId && p.unitId === unitId,
    );

  // 1. Prix de base : celui du parfum s'il en a un, sinon celui du produit (BR-CAT-14)
  const lines: PricedLine[] = [];
  const unpriced: UnpricedLine[] = [];
  for (const line of input) {
    if (line.qty <= 0) continue;
    const variant = variantById.get(line.variantId);
    const unit = unitById.get(line.unitId);
    if (!variant || !unit || unit.productId !== variant.productId) {
      unpriced.push({ ...line, reason: 'UNKNOWN' });
      continue;
    }
    if (!variant.isActive) {
      unpriced.push({ ...line, reason: 'INACTIVE' });
      continue;
    }
    const own = priceOf(variant.productId, variant.id, unit.id);
    const price = own ?? priceOf(variant.productId, null, unit.id);
    if (!price) {
      unpriced.push({ ...line, reason: 'NO_PRICE' });
      continue;
    }
    lines.push({
      ...line,
      productId: variant.productId,
      basePrice: price.price,
      unitPrice: price.price,
      tierMinQty: null,
      ownPrice: own !== undefined,
      total: price.price * line.qty,
    });
  }

  // 2. Paliers (BR-CAT-05, BR-CAT-15) : le plus haut palier atteint, dans l'unité de la ligne
  for (const line of lines) {
    const tiers = catalog.tiers.filter(
      (t) =>
        t.productId === line.productId &&
        t.unitId === line.unitId &&
        t.variantId === (line.ownPrice ? line.variantId : null),
    );
    if (tiers.length === 0) continue;
    const best = (threshold: (t: CatalogTier) => number) =>
      tiers.filter((t) => threshold(t) >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
    const tier = best((t) => {
      // Parfum à prix propre, ou palier « chaque parfum » : sa seule quantité
      if (line.ownPrice || t.thresholdScope === 'PER_VARIANT') return line.qty;
      // Total des parfums qui ont le prix du produit, saisis dans la même unité
      return lines
        .filter((l) => l.productId === line.productId && l.unitId === line.unitId && !l.ownPrice)
        .reduce((sum, l) => sum + l.qty, 0);
    });
    if (tier) {
      line.unitPrice = tier.unitPrice;
      line.tierMinQty = tier.minQty;
      line.total = tier.unitPrice * line.qty;
    }
  }

  // 3. Bonus cumulatifs (BR-CAT-06, BR-CAT-07, BR-CAT-15)
  const baseQtyOf = (l: CartLineInput) => l.qty * (unitById.get(l.unitId)?.baseQty ?? 0);
  // Stock restant après les lignes payantes, puis après chaque ligne offerte
  const remaining = context.availableStock ? new Map(context.availableStock) : null;
  if (remaining) {
    for (const l of lines)
      remaining.set(l.variantId, (remaining.get(l.variantId) ?? 0) - baseQtyOf(l));
  }

  const freeLines: FreeLine[] = [];
  for (const rule of catalog.bonusRules) {
    if (!inPeriod(context.date, rule.validFrom, rule.validTo)) continue;
    if (rule.customerTypeIds.length > 0 && !rule.customerTypeIds.includes(context.customerTypeId))
      continue;
    const buyUnit = unitById.get(rule.buyUnitId);
    const freeUnit = unitById.get(rule.freeUnitId);
    if (!buyUnit || !freeUnit || rule.buyQty <= 0) continue;

    const bought = lines
      .filter(
        (l) =>
          l.productId === rule.buyProductId &&
          (rule.buyVariantId === null || l.variantId === rule.buyVariantId),
      )
      .reduce((sum, l) => sum + baseQtyOf(l), 0);
    const requestedQty = Math.floor(bought / (rule.buyQty * buyUnit.baseQty)) * rule.freeQty;
    if (requestedQty <= 0) continue;

    const candidates = catalog.variants.filter(
      (v) => v.productId === rule.freeProductId && v.isActive,
    );
    const stockOf = (variantId: string) => remaining?.get(variantId) ?? 0;
    let variantId: string | undefined;
    if (rule.freeVariantMode === 'FIXED' && rule.freeVariantId) {
      variantId = rule.freeVariantId;
    } else {
      const chosen = context.freeVariantChoices?.get(rule.id);
      variantId =
        chosen && candidates.some((c) => c.id === chosen)
          ? chosen
          : // Automatique : le parfum le plus en stock (BR-CAT-15)
            [...candidates].sort((a, b) => stockOf(b.id) - stockOf(a.id))[0]?.id;
    }
    if (!variantId) continue;

    let qty = requestedQty;
    if (remaining) {
      qty = Math.max(0, Math.min(requestedQty, Math.floor(stockOf(variantId) / freeUnit.baseQty)));
      remaining.set(variantId, stockOf(variantId) - qty * freeUnit.baseQty);
    }
    freeLines.push({
      ruleId: rule.id,
      ruleName: rule.name,
      productId: rule.freeProductId,
      variantId,
      unitId: freeUnit.id,
      qty,
      requestedQty,
      reducedForStock: qty < requestedQty,
    });
  }

  return {
    lines,
    freeLines,
    unpriced,
    total: lines.reduce((sum, l) => sum + l.total, 0),
  };
}
