import type {
  BonusRuleDto,
  ImportPreview,
  PriceGrid,
  PriceTierDto,
  ProductDto,
  ProductRangeDto,
  SimulatedCart,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Phase 12 : catalogue, prix, paliers, bonus et import des produits (UC-81, UC-83). */
describe('catalogue et prix', () => {
  let t: TestApp;
  let admin: string;
  let sup: string;
  let products: ProductDto[];
  let ranges: ProductRangeDto[];
  let typeIds: Record<string, string>;

  const product = (reference: string) => products.find((p) => p.reference === reference)!;
  const unit = (p: ProductDto, name: string) => p.units.find((u) => u.name === name)!.id;
  const variant = (p: ProductDto, name: string) => p.variants.find((v) => v.name === name)!.id;
  const simulate = (lines: { variantId: string; unitId: string; qty: number }[], type = 'DETAIL') =>
    call<SimulatedCart>(t.url, 'POST', '/pricing/simulate', {
      token: sup,
      body: { customerTypeId: typeIds[type], date: '2026-10-03', lines },
    });

  beforeAll(async () => {
    t = await startApp();
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    products = (await call<ProductDto[]>(t.url, 'GET', '/products', { token: sup })).body;
    ranges = (await call<ProductRangeDto[]>(t.url, 'GET', '/product-ranges', { token: sup })).body;
    const types = await call<{ id: string; code: string }[]>(t.url, 'GET', '/customer-types', {
      token: sup,
    });
    typeIds = Object.fromEntries(types.body.map((x) => [x.code, x.id]));
  });
  afterAll(() => t.close());

  it('liste le catalogue avec ses unités et ses parfums', () => {
    expect(products.map((p) => p.reference).sort()).toEqual(['BIMO', 'THON-HUI', 'THON-TOM']);
    expect(product('BIMO')).toMatchObject({ hasFlavors: true });
    expect(product('BIMO').variants.map((v) => v.name)).toEqual(['Chocolat', 'Fraise', 'Pistache']);
    expect(product('THON-TOM').hasFlavors).toBe(false);
    expect(product('THON-TOM').units.map((u) => [u.name, u.baseQty])).toEqual([
      ['triplette', 1],
      ['carton', 20],
    ]);
  });

  it('calcule un panier comme les exemples chiffrés (§22)', async () => {
    const tom = product('THON-TOM');
    const tier = await simulate([
      { variantId: tom.variants[0]!.id, unitId: unit(tom, 'carton'), qty: 12 },
    ]);
    expect(tier.body.total).toBe(67_200);
    expect(tier.body.lines[0]).toMatchObject({ unitPrice: 5600, tierMinQty: 10 });
    expect(tier.body.freeLines).toEqual([
      expect.objectContaining({ productName: "Thon à l'huile", unitName: 'triplette', qty: 48 }),
    ]);

    const bimo = product('BIMO');
    const carton = unit(bimo, 'carton');
    const flavors = await simulate([
      { variantId: variant(bimo, 'Chocolat'), unitId: carton, qty: 6 },
      { variantId: variant(bimo, 'Fraise'), unitId: carton, qty: 5 },
      { variantId: variant(bimo, 'Pistache'), unitId: carton, qty: 2 },
    ]);
    expect(flavors.body.total).toBe(15_450);
    expect(flavors.body.lines.map((l) => l.variantName)).toEqual([
      'Chocolat',
      'Fraise',
      'Pistache',
    ]);
  });

  it('le superviseur crée un produit et ses parfums (BR-CAT-12)', async () => {
    const created = await call<ProductDto>(t.url, 'POST', '/products', {
      token: sup,
      body: {
        reference: 'jus-ora',
        name: "Jus d'orange 1 L",
        rangeId: ranges[0]!.id,
        baseUnitName: 'bouteille',
        packagings: [{ name: 'pack', baseQty: 6 }],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.reference).toBe('JUS-ORA');
    expect(created.body.variants).toEqual([
      expect.objectContaining({ reference: 'JUS-ORA', isDefault: true }),
    ]);
    const article = created.body.variants[0]!.id;

    // Le premier parfum reprend l'article, avec son stock et son historique
    const first = await call<ProductDto>(t.url, 'POST', `/products/${created.body.id}/variants`, {
      token: sup,
      body: { reference: 'JUS-ORA-NAT', name: 'Nature' },
    });
    expect(first.body.variants).toEqual([
      expect.objectContaining({ id: article, name: 'Nature', isDefault: false }),
    ]);
    const second = await call<ProductDto>(t.url, 'POST', `/products/${created.body.id}/variants`, {
      token: sup,
      body: { reference: 'JUS-ORA-PUL', name: 'Pulpe' },
    });
    expect(second.body.hasFlavors).toBe(true);
    expect(second.body.variants).toHaveLength(2);

    const duplicate = await call(t.url, 'POST', '/products', {
      token: sup,
      body: {
        reference: 'BIMO-CHOC',
        name: 'Doublon',
        rangeId: ranges[0]!.id,
        baseUnitName: 'paquet',
      },
    });
    expect(duplicate.status).toBe(409);

    // Conditionnements : nom unique, unité de base toujours active
    const units = await call<ProductDto>(t.url, 'POST', `/products/${created.body.id}/units`, {
      token: sup,
      body: { name: 'carton', baseQty: 12 },
    });
    expect(units.body.units.map((u) => u.name)).toEqual(['bouteille', 'pack', 'carton']);
    const again = await call(t.url, 'POST', `/products/${created.body.id}/units`, {
      token: sup,
      body: { name: 'Pack', baseQty: 4 },
    });
    expect(again.status).toBe(409);
    const base = units.body.units.find((u) => u.isBase)!;
    const disabled = await call(t.url, 'PATCH', `/products/${created.body.id}/units/${base.id}`, {
      token: sup,
      body: { isActive: false },
    });
    expect(disabled.status).toBe(422);
  });

  it('les prix sont fixés par l’admin, et par le superviseur seulement avec P-10', async () => {
    const tom = product('THON-TOM');
    const grid = await call<PriceGrid>(t.url, 'GET', `/products/${tom.id}/prices`, { token: sup });
    expect(grid.body.prices).toHaveLength(5);
    const forbidden = await call(t.url, 'PUT', `/products/${tom.id}/prices`, {
      token: sup,
      body: { prices: grid.body.prices },
    });
    expect(forbidden.status).toBe(403);

    // L'admin retire le prix Gros et change le prix Détail du carton
    const prices = grid.body.prices
      .filter((p) => p.customerTypeId !== typeIds.GROS)
      .map((p) =>
        p.customerTypeId === typeIds.DETAIL && p.unitId === unit(tom, 'carton')
          ? { ...p, price: 5900 }
          : p,
      );
    const saved = await call<PriceGrid>(t.url, 'PUT', `/products/${tom.id}/prices`, {
      token: admin,
      body: { prices },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.prices).toHaveLength(4);
    const eight = await simulate([
      { variantId: tom.variants[0]!.id, unitId: unit(tom, 'carton'), qty: 8 },
    ]);
    expect(eight.body.total).toBe(47_200);
    const gros = await simulate(
      [{ variantId: tom.variants[0]!.id, unitId: unit(tom, 'carton'), qty: 1 }],
      'GROS',
    );
    expect(gros.body.unpriced[0]?.reason).toBe('NO_PRICE');

    // Remise en place, puis P-10 : le superviseur peut modifier les prix
    await call(t.url, 'PUT', `/products/${tom.id}/prices`, {
      token: admin,
      body: { prices: grid.body.prices },
    });
    const settings = await call<{ data: { rules: Record<string, boolean> } }>(
      t.url,
      'GET',
      '/settings',
      { token: admin },
    );
    const withP10 = (value: boolean) => ({
      ...settings.body.data,
      rules: { ...settings.body.data.rules, P10_supervisorEditsPrices: value },
    });
    await call(t.url, 'PUT', '/settings', { token: admin, body: withP10(true) });
    try {
      const supervisor = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
      const allowed = await call(t.url, 'PUT', `/products/${tom.id}/prices`, {
        token: supervisor,
        body: { prices: grid.body.prices },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await call(t.url, 'PUT', '/settings', { token: admin, body: withP10(false) });
    }
  });

  it('donne un prix propre à un parfum (BR-CAT-14) et refuse un parfum d’un autre produit', async () => {
    const bimo = product('BIMO');
    const grid = await call<PriceGrid>(t.url, 'GET', `/products/${bimo.id}/prices`, {
      token: admin,
    });
    const foreign = await call(t.url, 'PUT', `/products/${bimo.id}/prices`, {
      token: admin,
      body: {
        prices: [
          {
            variantId: product('THON-TOM').variants[0]!.id,
            customerTypeId: typeIds.DETAIL,
            unitId: unit(bimo, 'carton'),
            price: 1,
          },
        ],
      },
    });
    expect(foreign.status).toBe(422);
    const own = grid.body.prices.filter((p) => p.variantId === variant(bimo, 'Pistache'));
    expect(own.length).toBeGreaterThan(0);
  });

  it('gère les paliers : doublon refusé, suppression puis recréation', async () => {
    const hui = product('THON-HUI');
    const body = {
      productId: hui.id,
      customerTypeId: typeIds.DETAIL,
      unitId: unit(hui, 'carton'),
      minQty: 5,
      unitPrice: 6000,
    };
    const forbidden = await call(t.url, 'POST', '/price-tiers', { token: sup, body });
    expect(forbidden.status).toBe(403);
    const created = await call<PriceTierDto>(t.url, 'POST', '/price-tiers', { token: admin, body });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      minQty: 5,
      unitPrice: 6000,
      thresholdScope: 'ALL_VARIANTS',
    });
    expect((await call(t.url, 'POST', '/price-tiers', { token: admin, body })).status).toBe(409);

    const five = await simulate([
      { variantId: hui.variants[0]!.id, unitId: unit(hui, 'carton'), qty: 5 },
    ]);
    expect(five.body.total).toBe(30_000);

    expect(
      (await call(t.url, 'DELETE', `/price-tiers/${created.body.id}`, { token: admin })).status,
    ).toBe(204);
    const revived = await call<PriceTierDto>(t.url, 'POST', '/price-tiers', {
      token: admin,
      body: { ...body, unitPrice: 6050 },
    });
    expect(revived.body).toMatchObject({ id: created.body.id, unitPrice: 6050 });
    await call(t.url, 'DELETE', `/price-tiers/${created.body.id}`, { token: admin });
  });

  it('crée une règle de bonus et vérifie le parfum offert (BR-CAT-06, BR-CAT-15)', async () => {
    const bimo = product('BIMO');
    const base = {
      name: '10 cartons Bimo : 6 paquets offerts',
      buyProductId: bimo.id,
      buyUnitId: unit(bimo, 'carton'),
      buyQty: 10,
      freeProductId: bimo.id,
      freeUnitId: unit(bimo, 'paquet'),
      freeQty: 6,
      validFrom: '2026-10-01',
      customerTypeIds: [typeIds.DETAIL],
    };
    const fixedWithout = await call(t.url, 'POST', '/bonus-rules', {
      token: admin,
      body: { ...base, freeVariantMode: 'FIXED' },
    });
    expect(fixedWithout.status).toBe(422);

    const created = await call<BonusRuleDto>(t.url, 'POST', '/bonus-rules', {
      token: admin,
      body: base,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      freeVariantMode: 'AUTO_MOST_STOCK',
      customerTypes: [{ name: 'Détail' }],
    });

    const cart = await simulate([
      { variantId: variant(bimo, 'Chocolat'), unitId: unit(bimo, 'carton'), qty: 6 },
      { variantId: variant(bimo, 'Fraise'), unitId: unit(bimo, 'carton'), qty: 5 },
    ]);
    expect(cart.body.freeLines.find((l) => l.ruleName === base.name)?.qty).toBe(6);
    const superette = await simulate(
      [{ variantId: variant(bimo, 'Chocolat'), unitId: unit(bimo, 'carton'), qty: 10 }],
      'SUPERETTE',
    );
    expect(superette.body.freeLines.some((l) => l.ruleName === base.name)).toBe(false);

    const ended = await call<BonusRuleDto>(t.url, 'PATCH', `/bonus-rules/${created.body.id}`, {
      token: admin,
      body: { validTo: '2026-09-30' },
    });
    expect(ended.status).toBe(422);
    expect(
      (await call(t.url, 'DELETE', `/bonus-rules/${created.body.id}`, { token: admin })).status,
    ).toBe(204);
    const rules = await call<BonusRuleDto[]>(t.url, 'GET', '/bonus-rules', { token: sup });
    expect(rules.body.some((r) => r.id === created.body.id)).toBe(false);
  });

  it('importe des produits, leurs parfums et leurs prix (BR-IO-02)', async () => {
    const template = await fetch(`${t.url}/imports/templates/products`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(await template.text()).toContain('prix_DETAIL_carton');

    const csv = [
      'reference_produit;nom_produit;gamme;categorie;unite_base;conditionnements;reference_parfum;nom_parfum;prix_DETAIL_carton;prix_DETAIL_paquet',
      'CHIPS;Chips 50 g;Snacks;Apéritif;paquet;carton=30;;;900;35',
      'CHIPS;;;;;;CHIPS-SEL;Sel;;',
      'CHIPS;;;;;;CHIPS-PAP;Paprika;950;37',
      'THON-TOM;Thon tomate bis;THON;;triplette;carton=20;;;;',
      'GAUF;Gaufrette;BIMO;;paquet;carton=un;;;;',
      'GAUF;;;;;;GAUF-CHOC;Chocolat;;',
    ].join('\r\n');
    const form = new FormData();
    form.append('kind', 'PRODUCTS');
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'produits.csv');
    const upload = await fetch(`${t.url}/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    });
    expect(upload.status).toBe(201);
    const preview = (await upload.json()) as ImportPreview;
    expect(preview).toMatchObject({ kind: 'PRODUCTS', totalRows: 6, validRows: 3 });
    expect(preview.errors.map((e) => e.line)).toEqual([5, 6]);
    expect(preview.sample[0]!.values).toEqual([
      'CHIPS',
      'Chips 50 g',
      'Sel, Paprika',
      'Snacks (nouvelle)',
      'paquet, carton = 30',
      '4 prix',
    ]);

    const confirmed = await call<ImportPreview>(t.url, 'POST', `/imports/${preview.id}/confirm`, {
      token: admin,
    });
    expect(confirmed.body).toMatchObject({ status: 'IMPORTED', importedRows: 3 });

    const list = await call<ProductDto[]>(t.url, 'GET', '/products?q=CHIPS', { token: admin });
    const chips = list.body[0]!;
    expect(chips.variants.map((v) => v.reference)).toEqual(['CHIPS-SEL', 'CHIPS-PAP']);
    const sel = await simulate([
      { variantId: variant(chips, 'Sel'), unitId: unit(chips, 'carton'), qty: 2 },
      { variantId: variant(chips, 'Paprika'), unitId: unit(chips, 'carton'), qty: 1 },
    ]);
    expect(sel.body.total).toBe(2 * 900 + 950);
  });
});
