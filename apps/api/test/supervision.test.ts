import type {
  CustomerDto,
  ObjectiveDto,
  OrderDto,
  Page,
  PendingLineDto,
  ProductDto,
  ProductRangeDto,
  QuotaDto,
  VisitCatalog,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

/** Écrans Web du superviseur (phase 16). */
describe('supervision (phase 16)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let phones: Phones;
  let sup: string;
  let products: ProductDto[];
  let v07: { id: string };

  const thon = () => {
    const p = products.find((x) => x.reference === 'THON-TOM')!;
    return { variantId: p.variants[0]!.id, cartonId: p.units.find((u) => u.name === 'carton')!.id };
  };

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;
    v07 = await raw.user.findFirstOrThrow({
      where: { code: 'V07', company: { code: 'DISTRI-ORAN' } },
    });
  });
  afterAll(() => t.close());

  describe('quotas du jour (UC-55)', () => {
    const date = '2026-12-05';

    it('enregistre en unité de base, montre au téléphone, supprime à 0', async () => {
      const put = (qty: number) =>
        call<QuotaDto[]>(t.url, 'PUT', '/quotas', {
          token: sup,
          body: {
            date,
            entries: [
              { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty },
            ],
          },
        });
      const saved = await put(3);
      expect(saved.status).toBe(200);
      const list = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: sup });
      expect(list.body).toContainEqual(
        expect.objectContaining({
          user: expect.objectContaining({ code: 'V07' }),
          productVariantId: thon().variantId,
          qty: 60,
          enteredQty: 3,
          consumedQty: 0,
        }),
      );

      const p = await phones.get('V07');
      const sector = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?limit=1', {
        token: p.token,
      });
      const catalog = await call<VisitCatalog>(
        t.url,
        'GET',
        `/me/visit-catalog?customerId=${sector.body.data[0]!.id}&date=${date}`,
        { token: p.token },
      );
      const variant = catalog.body.products
        .flatMap((x) => x.variants)
        .find((v) => v.id === thon().variantId);
      expect(variant).toMatchObject({ quotaRemaining: 60, quotaReached: false });

      expect((await put(0)).status).toBe(200);
      const after = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: sup });
      expect(after.body.some((q) => q.productVariantId === thon().variantId)).toBe(false);
    });

    it('refuse une date passée et un utilisateur sans droit', async () => {
      const past = await call(t.url, 'PUT', '/quotas', {
        token: sup,
        body: {
          date: '2026-01-03',
          entries: [
            { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 1 },
          ],
        },
      });
      expect(past.status).toBe(422);
      const p = await phones.get('V07');
      const seller = await call(t.url, 'PUT', '/quotas', {
        token: p.token,
        body: {
          date,
          entries: [
            { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 1 },
          ],
        },
      });
      expect(seller.status).toBe(403);
    });
  });

  describe('objectifs du mois (UC-56)', () => {
    it('fixe la cible, la prime et le plafond, et calcule le réalisé', async () => {
      const ranges = await call<ProductRangeDto[]>(t.url, 'GET', '/product-ranges', {
        token: sup,
      });
      const bimo = ranges.body.find((r) => r.code === 'BIMO')!;
      const put = await call<ObjectiveDto[]>(t.url, 'PUT', '/objectives', {
        token: sup,
        body: {
          month: '2026-12',
          entries: [
            {
              userId: v07.id,
              rangeId: bimo.id,
              targetAmount: 1_000_000,
              bonusAmount: 10_000,
              capPercent: 120,
            },
          ],
        },
      });
      expect(put.status).toBe(200);
      const list = await call<ObjectiveDto[]>(t.url, 'GET', '/objectives?month=2026-12', {
        token: sup,
      });
      expect(list.body).toContainEqual(
        expect.objectContaining({
          user: expect.objectContaining({ code: 'V07' }),
          range: expect.objectContaining({ code: 'BIMO' }),
          targetAmount: 1_000_000,
          bonusAmount: 10_000,
          capPercent: 120,
          realizedAmount: 0,
          estimatedBonus: 0,
        }),
      );
      const p = await phones.get('V07');
      expect(
        (
          await call(t.url, 'PUT', '/objectives', {
            token: p.token,
            body: { month: '2026-12', entries: [] },
          })
        ).status,
      ).toBe(403);
    });
  });
  describe('lignes en attente et historique (UC-60)', () => {
    const date = '2026-12-12';

    it('accepte dans la ligne normale, signale la rupture, refuse en vente perdue', async () => {
      const bimoFra = products
        .find((x) => x.reference === 'BIMO')!
        .variants.find((v) => v.reference === 'BIMO-FRA')!.id;
      const bimoCarton = products
        .find((x) => x.reference === 'BIMO')!
        .units.find((u) => u.name === 'carton')!.id;
      await call(t.url, 'PUT', '/quotas', {
        token: sup,
        body: {
          date,
          entries: [
            { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 1 },
            { userId: v07.id, productVariantId: bimoFra, unitId: bimoCarton, qty: 1 },
          ],
        },
      });
      const p = await phones.get('V07');
      const workdayId = await phones.startDay(p, date);
      const [c1, c2] = (await phones.today(p, date)).body.day.customers;

      const orderId = uuidv7();
      await phones.send(p, 'order.confirm', {
        orderId,
        number: `V07-${p.series}0201`,
        visitId: await phones.startVisit(p, c1!.id),
        lines: [
          { variantId: thon().variantId, unitId: thon().cartonId, qty: 3 },
          { variantId: bimoFra, unitId: bimoCarton, qty: 2 },
        ],
      });

      const pending = await call<PendingLineDto[]>(t.url, 'GET', `/pending-lines?date=${date}`, {
        token: sup,
      });
      const mine = pending.body.filter((l) => l.orderId === orderId);
      expect(mine.map((l) => [l.productName, l.qty]).sort()).toEqual([
        ['Biscuit Bimo', 1],
        ['Thon tomate', 2],
      ]);
      const thonLine = mine.find((l) => l.productName === 'Thon tomate')!;
      const bimoLine = mine.find((l) => l.productName === 'Biscuit Bimo')!;

      const decide = (lineIds: string[], decision: 'ACCEPT' | 'REFUSE') =>
        call(t.url, 'POST', '/pending-lines/decide', { token: sup, body: { lineIds, decision } });

      expect((await decide([thonLine.id], 'ACCEPT')).status).toBe(200);
      // Plus de stock disponible pour le Bimo fraise : acceptée, mais en rupture
      const stock = await raw.stock.findFirstOrThrow({
        where: { productVariantId: bimoFra, warehouse: { type: 'DEPOT' } },
      });
      await raw.stock.update({ where: { id: stock.id }, data: { reservedQty: stock.physicalQty } });
      try {
        expect((await decide([bimoLine.id], 'ACCEPT')).status).toBe(200);
      } finally {
        const now = await raw.stock.findUniqueOrThrow({ where: { id: stock.id } });
        await raw.stock.update({
          where: { id: stock.id },
          data: { reservedQty: now.reservedQty - (stock.physicalQty - stock.reservedQty) },
        });
      }
      expect((await decide([thonLine.id], 'ACCEPT')).status).toBe(409);

      const detail = await call<OrderDto>(t.url, 'GET', `/orders/${orderId}`, { token: sup });
      const normal = (name: string) =>
        detail.body.lines.find((l) => l.kind === 'NORMAL' && l.productName === name)!;
      expect(normal('Thon tomate')).toMatchObject({
        enteredQty: 3,
        reservedQty: 60,
        isStockout: false,
      });
      expect(normal('Biscuit Bimo')).toMatchObject({ enteredQty: 2, isStockout: true });
      expect(detail.body.totalAmount).toBe(3 * 5800 + 2 * 1200);
      expect(
        detail.body.lines.filter((l) => l.kind === 'PENDING').map((l) => l.pendingStatus),
      ).toEqual(['ACCEPTED', 'ACCEPTED']);

      // Quota épuisé : tout part en attente ; refusé, c'est une vente perdue
      const second = uuidv7();
      await phones.send(p, 'order.confirm', {
        orderId: second,
        number: `V07-${p.series}0202`,
        visitId: await phones.startVisit(p, c2!.id),
        lines: [{ variantId: thon().variantId, unitId: thon().cartonId, qty: 1 }],
      });
      const line = (
        await call<PendingLineDto[]>(t.url, 'GET', `/pending-lines?date=${date}`, {
          token: sup,
        })
      ).body.find((l) => l.orderId === second)!;
      expect((await decide([line.id], 'REFUSE')).status).toBe(200);
      expect(
        await raw.lostDemand.count({ where: { orderLineId: line.id, kind: 'LOST_SALE' } }),
      ).toBe(1);

      const history = await call<OrderDto[]>(
        t.url,
        'GET',
        `/orders?date=${date}&sellerId=${v07.id}`,
        { token: sup },
      );
      expect(history.body.map((o) => o.id).sort()).toEqual([orderId, second].sort());
      // Sur le téléphone, un vendeur ne voit que ses commandes, même avec orders.read
      const v08 = await phones.get('V08');
      const others = await call<OrderDto[]>(t.url, 'GET', `/orders?date=${date}`, {
        token: v08.token,
      });
      expect(others.body.some((o) => o.id === orderId)).toBe(false);
      expect((await call(t.url, 'GET', `/orders/${orderId}`, { token: v08.token })).status).toBe(404);
      await phones.closeDay(p, workdayId);
    });
  });
});
