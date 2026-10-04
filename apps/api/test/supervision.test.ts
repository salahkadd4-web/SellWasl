import type {
  CustomerDto,
  MyObjective,
  ObjectiveDto,
  OrderDto,
  Page,
  PendingLineDto,
  ProductDto,
  ProductRangeDto,
  QuotaDto,
  VisitCatalog,
  WorkdayDto,
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
  afterAll(async () => {
    // Commandes de test annulées : modules.test.ts change le mode de l'entreprise, ce qu'une
    // commande non livrée empêche (docs/modules.md §8)
    await raw.order.updateMany({
      where: {
        company: { code: 'DISTRI-ORAN' },
        orderDate: {
          in: ['2026-12-12', '2026-12-19', '2026-12-26'].map((d) => new Date(`${d}T00:00:00Z`)),
        },
      },
      data: { status: 'CANCELLED' },
    });
    await t.close();
  });

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

      // Sur le téléphone, chacun ne voit que ses quotas et ses objectifs
      const v08 = await raw.user.findFirstOrThrow({
        where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
      });
      await call(t.url, 'PUT', '/quotas', {
        token: sup,
        body: {
          date,
          entries: [
            { userId: v08.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 2 },
          ],
        },
      });
      const mine = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: p.token });
      expect(mine.body.length).toBeGreaterThan(0);
      expect(mine.body.every((q) => q.user.code === 'V07')).toBe(true);
      const objectives = await call<ObjectiveDto[]>(t.url, 'GET', '/objectives?month=2026-10', {
        token: p.token,
      });
      expect(objectives.body.length).toBeGreaterThan(0);
      expect(objectives.body.every((o) => o.user.code === 'V07')).toBe(true);

      expect((await put(0)).status).toBe(200);
      const after = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: sup });
      expect(
        after.body.some((q) => q.productVariantId === thon().variantId && q.user.code === 'V07'),
      ).toBe(false);
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
  describe('plafond des primes de l’entreprise (BR-OBJ-01)', () => {
    /** Mois décalé de n par rapport au mois courant, « AAAA-MM ». */
    const monthOffset = (n: number) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      return d.toISOString().slice(0, 7);
    };

    it('fixe un seul plafond, appliqué aux mois en cours et futurs, jamais aux mois passés', async () => {
      const capOf = async () =>
        (await call<{ capPercent: number | null }>(t.url, 'GET', '/objectives/cap', { token: sup }))
          .body.capPercent;
      expect(await capOf()).toBe(120);

      const ranges = await call<ProductRangeDto[]>(t.url, 'GET', '/product-ranges', { token: sup });
      const thonRange = ranges.body.find((r) => r.code === 'THON')!;
      const past = monthOffset(-1);
      const future = monthOffset(2);
      await raw.objective.create({
        data: {
          id: uuidv7(),
          companyId: (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id,
          userId: v07.id,
          rangeId: thonRange.id,
          month: new Date(`${past}-01T00:00:00Z`),
          targetAmount: 1_000_000n,
          bonusAmount: 10_000n,
          capPercent: 120,
        },
      });
      // Cible seule : la prime et le plafond viennent de l'entreprise
      expect(
        (
          await call(t.url, 'PUT', '/objectives', {
            token: sup,
            body: {
              month: future,
              entries: [
                {
                  userId: v07.id,
                  rangeId: thonRange.id,
                  targetAmount: 2_000_000,
                  bonusAmount: 12_000,
                },
              ],
            },
          })
        ).status,
      ).toBe(200);

      const p = await phones.get('V07');
      const refused = await call(t.url, 'PUT', '/objectives/cap', {
        token: p.token,
        body: { capPercent: 150 },
      });
      expect(refused.status).toBe(403);

      try {
        expect(
          (await call(t.url, 'PUT', '/objectives/cap', { token: sup, body: { capPercent: 150 } }))
            .status,
        ).toBe(200);
        expect(await capOf()).toBe(150);
        const cap = async (month: string) =>
          (
            await call<ObjectiveDto[]>(t.url, 'GET', `/objectives?month=${month}`, { token: sup })
          ).body.find((o) => o.user.code === 'V07' && o.range.code === 'THON')?.capPercent;
        expect(await cap(future)).toBe(150);
        expect(await cap(past)).toBe(120);

        // Pas de plafond : la prime suit le taux sans limite
        expect(
          (await call(t.url, 'PUT', '/objectives/cap', { token: sup, body: { capPercent: null } }))
            .status,
        ).toBe(200);
        expect(await capOf()).toBeNull();
        expect(await cap(future)).toBeNull();
        expect(await cap(past)).toBe(120);
      } finally {
        await call(t.url, 'PUT', '/objectives/cap', { token: sup, body: { capPercent: 120 } });
      }
    });
  });

  describe('versement des primes (fin du mois ou du mois suivant)', () => {
    const monthOffset = (n: number) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      return d.toISOString().slice(0, 7);
    };
    const endOf = (month: string, delay: number) => {
      const [y, m] = month.split('-').map(Number) as [number, number];
      return new Date(Date.UTC(y, m + delay, 0)).toISOString().slice(0, 10);
    };

    it('affiche la date de versement et garde l’objectif du mois précédent jusqu’à son paiement', async () => {
      const delayOf = async () =>
        (await call<{ delayMonths: number }>(t.url, 'GET', '/objectives/payment', { token: sup }))
          .body.delayMonths;
      expect(await delayOf()).toBe(0);

      const ranges = await call<ProductRangeDto[]>(t.url, 'GET', '/product-ranges', { token: sup });
      const bimo = ranges.body.find((r) => r.code === 'BIMO')!;
      const previous = monthOffset(-1);
      const current = monthOffset(0);
      const companyId = (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } }))
        .id;
      // Objectif du mois courant (celui du seed s'il existe déjà) et du mois précédent
      const ensure = async (month: string) => {
        const date = new Date(`${month}-01T00:00:00Z`);
        const found = await raw.objective.findFirst({
          where: { userId: v07.id, rangeId: bimo.id, month: date },
        });
        if (!found)
          await raw.objective.create({
            data: {
              id: uuidv7(),
              companyId,
              userId: v07.id,
              rangeId: bimo.id,
              month: date,
              targetAmount: 3_000_000n,
              bonusAmount: 12_000n,
              capPercent: 120,
            },
          });
      };
      await ensure(current);
      await ensure(previous);

      const paymentDate = async (month: string) =>
        (
          await call<ObjectiveDto[]>(t.url, 'GET', `/objectives?month=${month}`, { token: sup })
        ).body.find((o) => o.user.code === 'V07' && o.range.code === 'BIMO')?.paymentDate;
      expect(await paymentDate(current)).toBe(endOf(current, 0));

      const p = await phones.get('V07');
      const phoneMonths = async () =>
        (await call<MyObjective[]>(t.url, 'GET', '/me/objectives', { token: p.token })).body
          .filter((o) => o.range.code === 'BIMO')
          .map((o) => o.month);
      expect(await phoneMonths()).toEqual([current]);

      expect(
        (
          await call(t.url, 'PUT', '/objectives/payment', {
            token: p.token,
            body: { delayMonths: 1 },
          })
        ).status,
      ).toBe(403);
      try {
        expect(
          (
            await call(t.url, 'PUT', '/objectives/payment', {
              token: sup,
              body: { delayMonths: 1 },
            })
          ).status,
        ).toBe(200);
        expect(await delayOf()).toBe(1);
        expect(await paymentDate(current)).toBe(endOf(current, 1));
        // Le mois précédent n'est versé qu'à la fin de ce mois-ci : le vendeur le voit encore
        expect(await phoneMonths()).toEqual([current, previous]);
      } finally {
        await call(t.url, 'PUT', '/objectives/payment', { token: sup, body: { delayMonths: 0 } });
      }
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
      const [c1, c2, c3] = (await phones.today(p, date)).body.day.customers;

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
      // Une ligne en attente déjà traitée : le vendeur ne peut plus refaire la commande
      const reedit = await phones.send(p, 'order.update', {
        orderId,
        lines: [{ variantId: thon().variantId, unitId: thon().cartonId, qty: 3 }],
      });
      expect(reedit).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });

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
      // Deux superviseurs acceptent la même ligne au même moment : appliquée une seule fois
      const twice = await Promise.all([decide([line.id], 'ACCEPT'), decide([line.id], 'ACCEPT')]);
      expect(twice.map((r) => r.status).sort()).toEqual([200, 409]);
      const secondDetail = await call<OrderDto>(t.url, 'GET', `/orders/${second}`, { token: sup });
      expect(
        secondDetail.body.lines.find((l) => l.kind === 'NORMAL' && l.productName === 'Thon tomate')
          ?.enteredQty,
      ).toBe(1);

      const third = uuidv7();
      await phones.send(p, 'order.confirm', {
        orderId: third,
        number: `V07-${p.series}0203`,
        visitId: await phones.startVisit(p, c3!.id),
        lines: [{ variantId: thon().variantId, unitId: thon().cartonId, qty: 1 }],
      });
      const refused = (
        await call<PendingLineDto[]>(t.url, 'GET', `/pending-lines?date=${date}`, { token: sup })
      ).body.find((l) => l.orderId === third)!;
      expect((await decide([refused.id], 'REFUSE')).status).toBe(200);
      expect(
        await raw.lostDemand.count({ where: { orderLineId: refused.id, kind: 'LOST_SALE' } }),
      ).toBe(1);

      const history = await call<OrderDto[]>(
        t.url,
        'GET',
        `/orders?date=${date}&sellerId=${v07.id}`,
        { token: sup },
      );
      expect(history.body.map((o) => o.id).sort()).toEqual([orderId, second, third].sort());
      // Sur le téléphone, un vendeur ne voit que ses commandes, même avec orders.read
      const v08 = await phones.get('V08');
      const others = await call<OrderDto[]>(t.url, 'GET', `/orders?date=${date}`, {
        token: v08.token,
      });
      expect(others.body.some((o) => o.id === orderId)).toBe(false);
      const forced = await call<OrderDto[]>(
        t.url,
        'GET',
        `/orders?date=${date}&sellerId=${v07.id}`,
        {
          token: v08.token,
        },
      );
      expect(forced.body.some((o) => o.id === orderId)).toBe(false);
      expect((await call(t.url, 'GET', `/orders/${orderId}`, { token: v08.token })).status).toBe(
        404,
      );
      await phones.closeDay(p, workdayId);
    });
  });
  describe('journées (UC-57, UC-58, UC-64)', () => {
    const date = '2026-12-19';

    it('rouvre une journée (commandes de nouveau modifiables), puis la referme sans doublon', async () => {
      const p = await phones.get('V08');
      const workdayId = await phones.startDay(p, date);
      const day = (await phones.today(p, date)).body.day;
      const orderId = uuidv7();
      await phones.send(p, 'order.confirm', {
        orderId,
        number: `V08-${p.series}0301`,
        visitId: await phones.startVisit(p, day.customers[0]!.id),
        lines: [{ variantId: thon().variantId, unitId: thon().cartonId, qty: 1 }],
      });
      await phones.closeDay(p, workdayId);
      const missedBefore = await raw.visit.count({
        where: { workdayId, status: 'MISSED', deletedAt: null },
      });
      expect(missedBefore).toBe(day.customers.length - 1);

      const reopen = (body: unknown) =>
        call(t.url, 'POST', `/workdays/${workdayId}/reopen`, { token: sup, body });
      expect((await reopen({})).status).toBe(400);
      expect((await reopen({ reason: 'Commande oubliée' })).status).toBe(200);
      const status = async () =>
        (await raw.order.findUniqueOrThrow({ where: { id: orderId } })).status;
      expect(await status()).toBe('CONFIRMED');
      expect(await raw.workday.findUniqueOrThrow({ where: { id: workdayId } })).toMatchObject({
        status: 'IN_PROGRESS',
        reopenCount: 1,
      });

      await phones.closeDay(p, workdayId);
      expect(await status()).toBe('LOCKED');
      expect(
        await raw.visit.count({ where: { workdayId, status: 'MISSED', deletedAt: null } }),
      ).toBe(missedBefore);

      // Préparation lancée : trop tard pour rouvrir (BR-JOU-08)
      await raw.order.update({ where: { id: orderId }, data: { status: 'PREPARING' } });
      try {
        expect((await reopen({ reason: 'Encore' })).status).toBe(409);
      } finally {
        await raw.order.update({ where: { id: orderId }, data: { status: 'LOCKED' } });
      }
    });

    it('clôture d’office une journée restée ouverte (BR-JOU-10) et liste les journées', async () => {
      const p = await phones.get('V07');
      const workdayId = await phones.startDay(p, date);
      const customer = (await phones.today(p, date)).body.day.customers[0]!;
      await phones.startVisit(p, customer.id);

      const forced = await call(t.url, 'POST', `/workdays/${workdayId}/force-close`, {
        token: sup,
        body: { reason: 'Téléphone cassé' },
      });
      expect(forced.status).toBe(200);
      expect(await raw.workday.findUniqueOrThrow({ where: { id: workdayId } })).toMatchObject({
        status: 'CLOSED',
        isForceClosed: true,
      });
      expect(
        await raw.visit.count({ where: { workdayId, status: 'IN_PROGRESS', deletedAt: null } }),
      ).toBe(0);

      const list = await call<WorkdayDto[]>(t.url, 'GET', `/workdays?date=${date}`, {
        token: sup,
      });
      const byCode = Object.fromEntries(list.body.map((w) => [w.user.code, w]));
      expect(byCode.V07).toMatchObject({ status: 'CLOSED', isForceClosed: true });
      expect(byCode.V08).toMatchObject({ status: 'CLOSED', reopenCount: 1, ordersCount: 1 });
      expect(byCode.V08!.visits.done).toBe(1);
    });
  });
  describe('réservations simultanées', () => {
    it('ne réserve jamais plus que le stock, même pour deux commandes au même instant', async () => {
      const date = '2026-12-26';
      const bimo = products.find((x) => x.reference === 'BIMO')!;
      const variantId = bimo.variants.find((v) => v.reference === 'BIMO-FRA')!.id;
      const unitId = bimo.units.find((u) => u.name === 'carton')!.id;
      const stock = await raw.stock.findFirstOrThrow({
        where: { productVariantId: variantId, warehouse: { type: 'DEPOT' } },
      });
      // Un seul carton disponible
      await raw.stock.update({
        where: { id: stock.id },
        data: { reservedQty: stock.physicalQty - 24 },
      });
      try {
        const sellers = await Promise.all([phones.get('V07'), phones.get('V08')]);
        const prepared = [];
        for (const p of sellers) {
          const workdayId = await phones.startDay(p, date);
          const customer = (await phones.today(p, date)).body.day.customers[0]!;
          const visitId = await phones.startVisit(p, customer.id);
          prepared.push({ p, workdayId, visitId });
        }
        const replies = await Promise.all(
          prepared.map(({ p, visitId }, i) =>
            phones.send(p, 'order.confirm', {
              orderId: uuidv7(),
              number: `C${i}-${p.series}0401`,
              visitId,
              lines: [{ variantId, unitId, qty: 1 }],
            }),
          ),
        );
        expect(replies.map((r) => r.status)).toEqual(['APPLIED', 'APPLIED']);
        const stockouts = replies.filter(
          (r) => (r.result?.stockouts as unknown[] | undefined)?.length,
        );
        expect(stockouts).toHaveLength(1);
        const after = await raw.stock.findUniqueOrThrow({ where: { id: stock.id } });
        expect(after.reservedQty).toBe(after.physicalQty);
        for (const { p, workdayId } of prepared) await phones.closeDay(p, workdayId);
      } finally {
        await raw.stock.update({
          where: { id: stock.id },
          data: { reservedQty: stock.reservedQty },
        });
      }
    });
  });
});
