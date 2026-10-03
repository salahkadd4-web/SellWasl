import { describe, expect, it } from 'vitest';
import { type PricingCatalog, priceCart } from './pricing';

// Exemples chiffrés de docs/business-rules.md §22
const DETAIL = 'DETAIL';
const catalog: PricingCatalog = {
  units: [
    { id: 'tom-trip', productId: 'TOM', baseQty: 1 },
    { id: 'tom-ctn', productId: 'TOM', baseQty: 20 },
    { id: 'hui-trip', productId: 'HUI', baseQty: 1 },
    { id: 'bimo-pqt', productId: 'BIMO', baseQty: 1 },
    { id: 'bimo-ctn', productId: 'BIMO', baseQty: 24 },
  ],
  variants: [
    { id: 'TOM', productId: 'TOM', isActive: true },
    { id: 'HUI', productId: 'HUI', isActive: true },
    { id: 'CHOC', productId: 'BIMO', isActive: true },
    { id: 'FRA', productId: 'BIMO', isActive: true },
    { id: 'PIS', productId: 'BIMO', isActive: true },
  ],
  prices: [
    { productId: 'TOM', variantId: null, unitId: 'tom-ctn', price: 5800 },
    { productId: 'TOM', variantId: null, unitId: 'tom-trip', price: 300 },
    { productId: 'HUI', variantId: null, unitId: 'hui-trip', price: 320 },
    { productId: 'BIMO', variantId: null, unitId: 'bimo-ctn', price: 1200 },
    { productId: 'BIMO', variantId: 'PIS', unitId: 'bimo-ctn', price: 1400 },
  ],
  tiers: [
    {
      productId: 'TOM',
      variantId: null,
      unitId: 'tom-ctn',
      minQty: 10,
      unitPrice: 5600,
      thresholdScope: 'ALL_VARIANTS',
    },
    {
      productId: 'BIMO',
      variantId: null,
      unitId: 'bimo-ctn',
      minQty: 10,
      unitPrice: 1150,
      thresholdScope: 'ALL_VARIANTS',
    },
  ],
  bonusRules: [
    {
      id: 'B1',
      name: '1 carton de thon tomate : 4 triplettes de thon à l’huile',
      buyProductId: 'TOM',
      buyVariantId: null,
      buyUnitId: 'tom-ctn',
      buyQty: 1,
      freeProductId: 'HUI',
      freeVariantId: null,
      freeUnitId: 'hui-trip',
      freeQty: 4,
      freeVariantMode: 'AUTO_MOST_STOCK',
      validFrom: '2026-10-01',
      validTo: null,
      customerTypeIds: [],
    },
  ],
};
const context = { customerTypeId: DETAIL, date: '2026-10-03' };

describe('paliers (BR-CAT-05)', () => {
  it('applique le palier à partir de 10 cartons', () => {
    expect(
      priceCart(catalog, [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 8 }], context).total,
    ).toBe(46_400);
    const cart = priceCart(catalog, [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 12 }], context);
    expect(cart.total).toBe(67_200);
    expect(cart.lines[0]).toMatchObject({ unitPrice: 5600, tierMinQty: 10 });
  });

  it('ne compte que les lignes saisies dans l’unité du palier', () => {
    const cart = priceCart(
      catalog,
      [
        { variantId: 'TOM', unitId: 'tom-ctn', qty: 9 },
        { variantId: 'TOM', unitId: 'tom-trip', qty: 40 },
      ],
      context,
    );
    expect(cart.lines[0]!.unitPrice).toBe(5800);
  });
});

describe('bonus cumulatifs (BR-CAT-06)', () => {
  it('3 cartons donnent 12 triplettes', () => {
    const cart = priceCart(catalog, [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 3 }], context);
    expect(cart.freeLines).toEqual([
      expect.objectContaining({ variantId: 'HUI', unitId: 'hui-trip', qty: 12 }),
    ]);
  });

  it('50 triplettes, soit 2,5 cartons, donnent 8 triplettes', () => {
    const cart = priceCart(catalog, [{ variantId: 'TOM', unitId: 'tom-trip', qty: 50 }], context);
    expect(cart.freeLines[0]!.qty).toBe(8);
  });

  it('limite le bonus au stock disponible (BR-CAT-07)', () => {
    const cart = priceCart(catalog, [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 3 }], {
      ...context,
      availableStock: new Map([['HUI', 5]]),
    });
    expect(cart.freeLines[0]).toMatchObject({ qty: 5, requestedQty: 12, reducedForStock: true });
  });

  it('respecte les dates de validité et les types de clients', () => {
    const lines = [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 3 }];
    expect(priceCart(catalog, lines, { ...context, date: '2026-09-30' }).freeLines).toEqual([]);
    const limited = {
      ...catalog,
      bonusRules: [{ ...catalog.bonusRules[0]!, customerTypeIds: ['GROS'] }],
    };
    expect(priceCart(limited, lines, context).freeLines).toEqual([]);
  });
});

describe('parfums (BR-CAT-13 à BR-CAT-16)', () => {
  it('cumule les parfums au prix du produit ; le parfum à prix propre est à part', () => {
    const cart = priceCart(
      catalog,
      [
        { variantId: 'CHOC', unitId: 'bimo-ctn', qty: 6 },
        { variantId: 'FRA', unitId: 'bimo-ctn', qty: 5 },
        { variantId: 'PIS', unitId: 'bimo-ctn', qty: 2 },
      ],
      context,
    );
    expect(cart.lines.map((l) => [l.variantId, l.unitPrice, l.total])).toEqual([
      ['CHOC', 1150, 6900],
      ['FRA', 1150, 5750],
      ['PIS', 1400, 2800],
    ]);
    expect(cart.total).toBe(15_450);
  });

  it('palier « chaque parfum séparément »', () => {
    const perVariant = {
      ...catalog,
      tiers: catalog.tiers.map((t) => ({ ...t, thresholdScope: 'PER_VARIANT' as const })),
    };
    const cart = priceCart(
      perVariant,
      [
        { variantId: 'CHOC', unitId: 'bimo-ctn', qty: 6 },
        { variantId: 'FRA', unitId: 'bimo-ctn', qty: 10 },
      ],
      context,
    );
    expect(cart.lines.map((l) => l.unitPrice)).toEqual([1200, 1150]);
  });

  it('offre le parfum le plus en stock, ou celui choisi par le vendeur', () => {
    const rule = {
      ...catalog.bonusRules[0]!,
      id: 'B2',
      buyProductId: 'BIMO',
      buyUnitId: 'bimo-ctn',
      buyQty: 10,
      freeProductId: 'BIMO',
      freeUnitId: 'bimo-pqt',
      freeQty: 6,
    };
    const withBimo = { ...catalog, bonusRules: [rule] };
    const lines = [
      { variantId: 'CHOC', unitId: 'bimo-ctn', qty: 6 },
      { variantId: 'FRA', unitId: 'bimo-ctn', qty: 5 },
    ];
    const availableStock = new Map([
      ['CHOC', 2400],
      ['FRA', 2400],
      ['PIS', 2000],
    ]);
    // Après les lignes payantes : chocolat 2256, fraise 2280, pistache 2000
    expect(priceCart(withBimo, lines, { ...context, availableStock }).freeLines[0]).toMatchObject({
      variantId: 'FRA',
      qty: 6,
    });
    const chosen = priceCart(withBimo, lines, {
      ...context,
      availableStock,
      freeVariantChoices: new Map([['B2', 'PIS']]),
    });
    expect(chosen.freeLines[0]!.variantId).toBe('PIS');
  });

  it('signale un article sans prix pour ce type de client (BR-CAT-04)', () => {
    const cart = priceCart(catalog, [{ variantId: 'HUI', unitId: 'tom-ctn', qty: 1 }], context);
    expect(cart.unpriced[0]!.reason).toBe('UNKNOWN');
    const noPrice = priceCart(
      { ...catalog, prices: [] },
      [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 1 }],
      context,
    );
    expect(noPrice.unpriced[0]!.reason).toBe('NO_PRICE');
  });
});
