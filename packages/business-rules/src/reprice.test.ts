import { describe, expect, it } from 'vitest';
import type { PricingCatalog } from './pricing';
import { RepriceError, repriceOrder } from './reprice';

// Grille simplifiée des exemples de docs/business-rules.md §22
const catalog: PricingCatalog = {
  units: [
    { id: 'tom-trip', productId: 'TOM', baseQty: 1 },
    { id: 'tom-ctn', productId: 'TOM', baseQty: 20 },
    { id: 'hui-trip', productId: 'HUI', baseQty: 1 },
    { id: 'bimo-ctn', productId: 'BIMO', baseQty: 24 },
  ],
  variants: [
    { id: 'TOM', productId: 'TOM', isActive: true },
    { id: 'HUI', productId: 'HUI', isActive: true },
    { id: 'CHOC', productId: 'BIMO', isActive: true },
  ],
  prices: [
    { productId: 'TOM', variantId: null, unitId: 'tom-ctn', price: 5800 },
    { productId: 'TOM', variantId: null, unitId: 'tom-trip', price: 300 },
    { productId: 'HUI', variantId: null, unitId: 'hui-trip', price: 320 },
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
      freeVariantMode: 'FIXED',
      validFrom: '2026-10-01',
      validTo: null,
      customerTypeIds: [],
    },
  ],
};
const order = { customerTypeId: 'DETAIL', date: '2026-10-03' };
const tom = (qty: number) => ({
  id: 'L1',
  variantId: 'TOM',
  unitId: 'tom-ctn',
  unitPrice: 5600,
  qty,
});
const bonus = (maxQty: number) => ({ id: 'B', bonusRuleId: 'B1', variantId: 'HUI', maxQty });

describe('recalcul des prix d’une commande (BR-CAT-10)', () => {
  it('sans recalcul ni ajout : prix confirmés et bonus préparés gardés', () => {
    const r = repriceOrder(catalog, order, [tom(8)], [bonus(48)], [], false);
    expect(r.prices.get('L1')).toBe(5600);
    expect(r.bonus.get('B')).toBe(48);
    expect(r.added).toEqual([]);
  });

  it('avec recalcul : sous le palier, le prix remonte ; le bonus suit les quantités', () => {
    const r = repriceOrder(catalog, order, [tom(8)], [bonus(48)], [], true);
    expect(r.prices.get('L1')).toBe(5800);
    expect(r.bonus.get('B')).toBe(32);
  });

  it('un bonus ne dépasse jamais ce qui a été préparé pour lui', () => {
    const r = repriceOrder(catalog, order, [tom(12)], [bonus(40)], [], true);
    expect(r.bonus.get('B')).toBe(40);
  });

  it('un produit ajouté augmente sa ligne, ou forme une nouvelle ligne chiffrée', () => {
    const same = repriceOrder(
      catalog,
      order,
      [tom(8)],
      [],
      [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 2 }],
      false,
    );
    expect(same.prices.get('L1')).toBe(5600);
    expect(same.added).toEqual([]);
    const fresh = repriceOrder(
      catalog,
      order,
      [tom(8)],
      [],
      [{ variantId: 'HUI', unitId: 'hui-trip', qty: 3 }],
      false,
    );
    expect(fresh.added).toEqual([
      { variantId: 'HUI', unitId: 'hui-trip', qty: 3, productId: 'HUI', unitPrice: 320 },
    ]);
  });

  it('refuse une autre unité que celle de la ligne, et un article sans prix', () => {
    expect(() =>
      repriceOrder(
        catalog,
        order,
        [tom(8)],
        [],
        [{ variantId: 'TOM', unitId: 'tom-trip', qty: 1 }],
        false,
      ),
    ).toThrow(RepriceError);
    expect(() =>
      repriceOrder(
        catalog,
        order,
        [tom(8)],
        [],
        [{ variantId: 'CHOC', unitId: 'bimo-ctn', qty: 1 }],
        false,
      ),
    ).toThrow('Article non proposable');
  });
});
