import type { CustomerDto, OrderDto, ProductDto, VisitCatalog } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi 7 novembre 2026 : partie 1 ; livraison le dimanche 8. Aucune autre suite n'y travaille. */
const DAY = '2026-11-07';

describe('commandes (phase 16)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let phones: Phones;
  let sup: string;
  let products: ProductDto[];

  /** Article d'un produit du seed : parfum (référence) et unité (nom). */
  function item(reference: string, unitName: string, variantReference = reference) {
    const product = products.find((p) => p.variants.some((v) => v.reference === variantReference))!;
    expect(product, reference).toBeTruthy();
    return {
      productId: product.id,
      variantId: product.variants.find((v) => v.reference === variantReference)!.id,
      unitId: product.units.find((u) => u.name === unitName)!.id,
    };
  }
  const line = (reference: string, unitName: string, qty: number, variant?: string) => {
    const i = item(reference, unitName, variant);
    return { variantId: i.variantId, unitId: i.unitId, qty };
  };

  async function depotStock(variantReference: string) {
    const variant = await raw.productVariant.findFirstOrThrow({
      where: { reference: variantReference, company: { code: 'DISTRI-ORAN' } },
    });
    return raw.stock.findFirstOrThrow({
      where: { productVariantId: variant.id, warehouse: { type: 'DEPOT' } },
    });
  }

  /** Un client « Détail » des clients du jour du vendeur. */
  async function detailCustomer(p: Phone, date: string, skip: string[] = []) {
    const day = (await phones.today(p, date)).body.day;
    for (const c of day.customers) {
      if (skip.includes(c.id)) continue;
      const fiche = await call<CustomerDto>(t.url, 'GET', `/customers/${c.id}`, { token: sup });
      if (fiche.body.customerType.code === 'DETAIL') return fiche.body;
    }
    throw new Error('Aucun client Détail ce jour-là');
  }

  const confirm = (p: Phone, payload: Record<string, unknown>) =>
    phones.send(p, 'order.confirm', { orderId: uuidv7(), ...payload });

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;
  });
  afterAll(async () => {
    // Commandes de test annulées : modules.test.ts change le mode de l'entreprise, ce qu'une
    // commande non livrée empêche (docs/modules.md §8)
    await raw.order.updateMany({
      where: {
        company: { code: 'DISTRI-ORAN' },
        orderDate: { in: [new Date(`${DAY}T00:00:00Z`), new Date('2026-11-14T00:00:00Z')] },
      },
      data: { status: 'CANCELLED' },
    });
    await t.close();
  });

  describe('confirmation (order.confirm)', () => {
    let p: Phone;
    let workdayId: string;
    let customer: CustomerDto;

    beforeAll(async () => {
      p = await phones.get('V08');
      // Quota du jour : 10 cartons de thon tomate (200 triplettes)
      const seller = await raw.user.findFirstOrThrow({
        where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
      });
      const thon = item('THON-TOM', 'carton');
      await raw.quota.create({
        data: {
          id: uuidv7(),
          companyId: seller.companyId,
          userId: seller.id,
          productVariantId: thon.variantId,
          date: new Date(`${DAY}T00:00:00Z`),
          qty: 200,
          enteredQty: 10,
          enteredUnitId: thon.unitId,
        },
      });
      workdayId = await phones.startDay(p, DAY);
      customer = await detailCustomer(p, DAY);
    });

    it('fige les prix du type, le palier, le bonus, scinde au quota et réserve le stock', async () => {
      const before = {
        thon: await depotStock('THON-TOM'),
        huile: await depotStock('THON-HUI'),
        choc: await depotStock('BIMO-CHOC'),
      };
      const visitId = await phones.startVisit(p, customer.id, 'PHONE');
      const number = `V08-${p.series}0001`;
      const result = await confirm(p, {
        number,
        visitId,
        lines: [line('THON-TOM', 'carton', 12), line('BIMO', 'carton', 2, 'BIMO-CHOC')],
      });
      expect(result).toMatchObject({
        status: 'APPLIED',
        result: {
          number,
          // 10 cartons au palier (5 600) + 2 cartons de Bimo (1 200) ; les 2 cartons en attente ne comptent pas
          totalAmount: 10 * 5600 + 2 * 1200,
          deliveryDate: '2026-11-08',
          pendingLines: [{ variantId: item('THON-TOM', 'carton').variantId, qty: 2 }],
          stockouts: [],
        },
      });

      const orders = await call<OrderDto[]>(t.url, 'GET', `/me/orders?date=${DAY}`, {
        token: p.token,
      });
      const order = orders.body.find((o) => o.number === number)!;
      expect(order).toMatchObject({ status: 'CONFIRMED', source: 'PHONE', visitId });
      const kinds = order.lines.map((l) => [l.kind, l.productName, l.enteredQty, l.unitPrice]);
      expect(kinds).toEqual(
        expect.arrayContaining([
          ['NORMAL', 'Thon tomate', 10, 5600],
          ['PENDING', 'Thon tomate', 2, 5600],
          ['NORMAL', 'Biscuit Bimo', 2, 1200],
          // Bonus sur les 10 cartons confirmés : 40 triplettes de thon à l'huile
          ['BONUS', "Thon à l'huile", 40, 0],
        ]),
      );

      expect((await depotStock('THON-TOM')).reservedQty - before.thon.reservedQty).toBe(200);
      expect((await depotStock('THON-HUI')).reservedQty - before.huile.reservedQty).toBe(40);
      expect((await depotStock('BIMO-CHOC')).reservedQty - before.choc.reservedQty).toBe(48);

      const day = (await phones.today(p, DAY)).body;
      expect(day.counters).toMatchObject({ visited: 1, ordersCount: 1, ordersAmount: 58_400 });
      expect(day.visits.find((v) => v.id === visitId)?.status).toBe('COMPLETED');
    });

    it('marque la rupture quand le stock du dépôt ne couvre pas la ligne (BR-CMD-04)', async () => {
      const other = await detailCustomer(p, DAY, [customer.id]);
      const stock = await depotStock('BIMO-PIS');
      const available = stock.physicalQty - stock.reservedQty;
      const cartons = Math.floor(available / 24) + 5;
      const visitId = await phones.startVisit(p, other.id, 'ON_SITE');
      const result = await confirm(p, {
        number: `V08-${p.series}0002`,
        visitId,
        lines: [line('BIMO', 'carton', cartons, 'BIMO-PIS')],
      });
      expect(result.status).toBe('APPLIED');
      expect(result.result?.stockouts).toEqual([
        {
          variantId: item('BIMO', 'carton', 'BIMO-PIS').variantId,
          reservedQty: available,
          orderedQty: cartons * 24,
        },
      ]);
      const after = await depotStock('BIMO-PIS');
      expect(after.reservedQty).toBe(after.physicalQty);

      // Plus de stock disponible : le parfum n'est plus proposé (BR-CMD-06), le quota atteint est signalé
      const catalog = await call<VisitCatalog>(
        t.url,
        'GET',
        `/me/visit-catalog?customerId=${customer.id}&date=${DAY}`,
        { token: p.token },
      );
      expect(catalog.status).toBe(200);
      const variants = catalog.body.products.flatMap((pr) => pr.variants);
      expect(variants.some((v) => v.id === item('BIMO', 'carton', 'BIMO-PIS').variantId)).toBe(
        false,
      );
      expect(variants.find((v) => v.id === item('THON-TOM', 'carton').variantId)).toMatchObject({
        quotaRemaining: 0,
        quotaReached: true,
      });
      expect(catalog.body.catalog.prices.length).toBeGreaterThan(0);
    });

    it('refuse une commande sans visite en cours, en double ou invalide', async () => {
      const visitless = await confirm(p, {
        number: `V08-${p.series}0003`,
        visitId: uuidv7(),
        lines: [line('THON-HUI', 'carton', 1)],
      });
      expect(visitless).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });

      const third = await detailCustomer(p, DAY, [
        customer.id,
        (await detailCustomer(p, DAY, [customer.id])).id,
      ]);
      const visitId = await phones.startVisit(p, third.id, 'PHONE');
      const twice = await confirm(p, {
        number: `V08-${p.series}0004`,
        visitId,
        lines: [line('THON-HUI', 'carton', 1), line('THON-HUI', 'carton', 2)],
      });
      expect(twice).toMatchObject({ status: 'REJECTED', error: { code: 'VALIDATION_ERROR' } });

      const wrongUnit = await confirm(p, {
        number: `V08-${p.series}0005`,
        visitId,
        lines: [
          {
            variantId: item('THON-HUI', 'carton').variantId,
            unitId: item('BIMO', 'carton', 'BIMO-CHOC').unitId,
            qty: 1,
          },
        ],
      });
      expect(wrongUnit).toMatchObject({ status: 'REJECTED', error: { code: 'BUSINESS_RULE' } });

      const taken = await confirm(p, {
        number: `V08-${p.series}0001`,
        visitId,
        lines: [line('THON-HUI', 'carton', 1)],
      });
      expect(taken).toMatchObject({ status: 'REJECTED', error: { code: 'DUPLICATE' } });

      // Deux confirmations de la même visite (double appui) : une seule commande
      const huile = await depotStock('THON-HUI');
      const reply = await phones.push(p, [
        phones.op(p, 'order.confirm', {
          orderId: uuidv7(),
          number: `V08-${p.series}0006`,
          visitId,
          lines: [line('THON-HUI', 'carton', 1)],
        }),
        phones.op(p, 'order.confirm', {
          orderId: uuidv7(),
          number: `V08-${p.series}0007`,
          visitId,
          lines: [line('THON-HUI', 'carton', 1)],
        }),
      ]);
      expect(reply.body.results.map((r) => r.status)).toEqual(['APPLIED', 'REJECTED']);
      expect((await depotStock('THON-HUI')).reservedQty - huile.reservedQty).toBe(20);
    });

    afterAll(async () => {
      await phones.closeDay(p, workdayId);
    });
  });
  describe('modification, annulation et clôture', () => {
    it('ajuste la réservation, libère à l’annulation et fige à la clôture (BR-CMD-02, BR-CMD-04)', async () => {
      const p = await phones.get('V08');
      const date = '2026-11-14';
      const workdayId = await phones.startDay(p, date);
      const [a, b] = await (async () => {
        const first = await detailCustomer(p, date);
        return [first, await detailCustomer(p, date, [first.id])];
      })();

      const orderA = uuidv7();
      const visitA = await phones.startVisit(p, a.id);
      const before = (await depotStock('THON-HUI')).reservedQty;
      expect(
        await phones.send(p, 'order.confirm', {
          orderId: orderA,
          number: `V08-${p.series}0101`,
          visitId: visitA,
          lines: [line('THON-HUI', 'carton', 5)],
        }),
      ).toMatchObject({ status: 'APPLIED', result: { totalAmount: 5 * 6200 } });
      expect((await depotStock('THON-HUI')).reservedQty - before).toBe(100);

      // Moins de cartons : le stock réservé de trop est rendu
      expect(
        await phones.send(p, 'order.update', {
          orderId: orderA,
          lines: [line('THON-HUI', 'carton', 2)],
        }),
      ).toMatchObject({ status: 'APPLIED', result: { totalAmount: 2 * 6200 } });
      expect((await depotStock('THON-HUI')).reservedQty - before).toBe(40);

      const orderB = uuidv7();
      const visitB = await phones.startVisit(p, b.id);
      await phones.send(p, 'order.confirm', {
        orderId: orderB,
        number: `V08-${p.series}0102`,
        visitId: visitB,
        lines: [line('THON-HUI', 'carton', 3)],
      });
      expect(await phones.send(p, 'order.cancel', { orderId: orderB })).toMatchObject({
        status: 'APPLIED',
      });
      expect((await depotStock('THON-HUI')).reservedQty - before).toBe(40);

      const day = (await phones.today(p, date)).body.counters;
      expect(day).toMatchObject({ ordersCount: 1, ordersAmount: 2 * 6200 });

      await phones.closeDay(p, workdayId);
      const orders = await call<OrderDto[]>(t.url, 'GET', `/me/orders?date=${date}`, {
        token: p.token,
      });
      expect(Object.fromEntries(orders.body.map((o) => [o.id, o.status]))).toEqual({
        [orderA]: 'LOCKED',
        [orderB]: 'CANCELLED',
      });
      const late = await phones.send(p, 'order.update', {
        orderId: orderA,
        lines: [line('THON-HUI', 'carton', 1)],
      });
      expect(late).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });
    });
  });
});
