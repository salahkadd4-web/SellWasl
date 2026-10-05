import type {
  LoadDto,
  ProductDto,
  TruckCheckLine,
  TruckStockDto,
  VisitCatalog,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite. */
const DAY = '2027-05-08';

/** Cash van, pointage du camion, bons et versements (phase 20). */
describe('cash van (phase 20)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let supB: string;
  let phones: Phones;
  let products: ProductDto[];
  let seller: Phone;
  let workdayId: string;
  let truckId: string;

  function item(variantReference: string, unitName = 'carton') {
    const product = products.find((p) => p.variants.some((v) => v.reference === variantReference))!;
    const unit = product.units.find((u) => u.name === unitName)!;
    return {
      variantId: product.variants.find((v) => v.reference === variantReference)!.id,
      unitId: unit.id,
      baseQty: unit.baseQty,
    };
  }

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    phones = new Phones(t, { 'CASHVAN-EST': supB });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supB }))
      .body;
    truckId = (
      await raw.warehouse.findFirstOrThrow({
        where: { company: { code: 'CASHVAN-EST' }, code: 'TRUCK-01' },
      })
    ).id;
    seller = await phones.get('C01', 'CASHVAN-EST');
    workdayId = uuidv7();
    const started = await phones.send(seller, 'workday.start', { workdayId, date: DAY });
    expect(started.status, JSON.stringify(started)).toBe('APPLIED');
  });
  afterAll(async () => {
    await raw.workday.updateMany({
      where: { company: { code: 'CASHVAN-EST' }, date: new Date(`${DAY}T00:00:00Z`) },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await raw.load.updateMany({
      where: { truckId, date: new Date(`${DAY}T00:00:00Z`) },
      data: { status: 'RECEIVED', receivedAt: new Date() },
    });
    await t.close();
  });

  describe('pointage du camion (BR-CV-02, BR-PRE-05)', () => {
    it('le vendeur pointe tout son camion : stock de la veille et chargement du jour', async () => {
      const thon = item('THON-TOM');
      const loaded = await call(t.url, 'POST', '/loads', {
        token: supB,
        body: {
          truckId,
          date: DAY,
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        },
      });
      expect(loaded.status).toBe(201);
      const lines = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: seller.token })
      ).body;
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.find((l) => l.variantId === thon.variantId)).toMatchObject({
        toReceive: thon.baseQty,
      });
      // Une triplette de thon tomate manque
      const checked = await phones.send(seller, 'truck.check', {
        lines: lines.map((l) => ({
          variantId: l.variantId,
          countedQty: l.variantId === thon.variantId ? l.inTruck - 1 : l.inTruck,
        })),
      });
      expect(checked.status, JSON.stringify(checked)).toBe('APPLIED');
      const load = await raw.load.findFirstOrThrow({
        where: { truckId, date: new Date(`${DAY}T00:00:00Z`) },
      });
      expect(load).toMatchObject({ status: 'RECEIVED', hasGap: true });
      const stock = (
        await call<TruckStockDto[]>(t.url, 'GET', '/me/truck-stock', { token: seller.token })
      ).body;
      expect(stock.find((s) => s.variantId === thon.variantId)?.qty).toBe(
        lines.find((l) => l.variantId === thon.variantId)!.inTruck - 1,
      );
      const after = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: seller.token })
      ).body;
      expect(after.every((l) => l.toReceive === 0)).toBe(true);
    });

    it('refuse un pointage incomplet', async () => {
      const lines = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: seller.token })
      ).body;
      const partial = await phones.send(seller, 'truck.check', {
        lines: lines.slice(1).map((l) => ({ variantId: l.variantId, countedQty: l.inTruck })),
      });
      expect(partial.status).toBe('REJECTED');
    });
  });

  describe('chargement cash van préparé puis validé (UC-62, BR-CV-01)', () => {
    let truck2: string;
    let loadId: string;
    beforeAll(async () => {
      truck2 = (
        await raw.warehouse.findFirstOrThrow({
          where: { company: { code: 'CASHVAN-EST' }, code: 'TRUCK-02' },
        })
      ).id;
    });

    it('le superviseur prépare le chargement, sans bouger le stock', async () => {
      const bimo = item('BIMO-CHOC');
      const planned = await call<LoadDto>(t.url, 'POST', '/loads/plan', {
        token: supB,
        body: {
          truckId: truck2,
          date: DAY,
          lines: [{ variantId: bimo.variantId, unitId: bimo.unitId, qty: 2 }],
        },
      });
      expect(planned.status, JSON.stringify(planned.body)).toBe(201);
      expect(planned.body).toMatchObject({ status: 'PLANNED', kind: 'CASH_VAN' });
      loadId = planned.body.id;
      expect(await raw.stockMovement.count({ where: { sourceId: loadId } })).toBe(0);
      const list = await call<LoadDto[]>(t.url, 'GET', '/loads/planned', { token: supB });
      expect(list.body.map((l) => l.id)).toContain(loadId);
      const seller = await phones.get('C02', 'CASHVAN-EST');
      expect(
        (
          await call(t.url, 'POST', '/loads/plan', {
            token: seller.token,
            body: { truckId: truck2, date: DAY, lines: [] },
          })
        ).status,
      ).toBe(403);
    });

    it('le magasinier valide les quantités réellement chargées : transfert vers le camion', async () => {
      const bimo = item('BIMO-CHOC');
      const before =
        (
          await raw.stock.findFirst({
            where: { warehouseId: truck2, productVariantId: bimo.variantId },
          })
        )?.physicalQty ?? 0;
      // Un seul carton chargé sur les deux prévus
      const validated = await call<LoadDto>(t.url, 'POST', `/loads/${loadId}/validate`, {
        token: supB,
        body: { lines: [{ variantId: bimo.variantId, loadedQty: bimo.baseQty }] },
      });
      expect(validated.status, JSON.stringify(validated.body)).toBe(200);
      expect(validated.body).toMatchObject({ status: 'LOADED' });
      const after = await raw.stock.findFirstOrThrow({
        where: { warehouseId: truck2, productVariantId: bimo.variantId },
      });
      expect(after.physicalQty).toBe(before + bimo.baseQty);
      expect(
        (
          await call(t.url, 'POST', `/loads/${loadId}/validate`, {
            token: supB,
            body: { lines: [{ variantId: bimo.variantId, loadedQty: 1 }] },
          })
        ).status,
      ).toBe(409);
      const last = await call<LoadDto>(t.url, 'GET', `/loads/last?truckId=${truck2}`, {
        token: supB,
      });
      expect(last.body.id).toBe(loadId);
    });
  });

  describe('vente cash van (UC-15, BR-CV-03, BR-CV-04, BR-QUO-04)', () => {
    let customers: { id: string }[];
    let saleNumber = 0;
    const number = () => `C01-${seller.series}20${String(++saleNumber).padStart(2, '0')}`;
    const catalogOf = (customerId: string) =>
      call<VisitCatalog>(t.url, 'GET', `/me/visit-catalog?customerId=${customerId}`, {
        token: seller.token,
      });
    const cartonPrice = (catalog: VisitCatalog, ref: string) => {
      const product = products.find((p) => p.variants.some((v) => v.reference === ref))!;
      return catalog.catalog.prices.find(
        (p) => p.productId === product.id && p.unitId === item(ref).unitId && p.variantId === null,
      )!.price;
    };

    beforeAll(async () => {
      customers = (await phones.today(seller, DAY)).body.day.customers;
      expect(customers.length).toBeGreaterThan(2);
    });

    it('vend depuis le camion : livrée tout de suite, stock du camion baissé, payée', async () => {
      const customer = customers[0]!;
      const visitId = await phones.startVisit(seller, customer.id, 'ON_SITE');
      const reply = await catalogOf(customer.id);
      expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(200);
      const catalog = reply.body;
      const thon = item('THON-TOM');
      expect(catalog.truckStock?.[thon.variantId]).toBeGreaterThan(0);
      const before = catalog.truckStock![thon.variantId]!;

      const tooMuch = await phones.send(seller, 'sale.confirm', {
        orderId: uuidv7(),
        number: number(),
        visitId,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 9999 }],
        cashAmount: 0,
      });
      expect(tooMuch.status).toBe('REJECTED');

      const orderId = uuidv7();
      const due = cartonPrice(catalog, 'THON-TOM');
      const sold = await phones.send(seller, 'sale.confirm', {
        orderId,
        number: number(),
        visitId,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        cashAmount: due,
      });
      expect(sold.status, JSON.stringify(sold)).toBe('APPLIED');
      const order = await raw.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order).toMatchObject({
        status: 'DELIVERED',
        source: 'CASH_VAN',
        totalAmount: BigInt(due),
      });
      const after = (await catalogOf(customers[1]!.id)).body.truckStock![thon.variantId];
      expect(after).toBe(before - thon.baseQty);
      expect(
        await raw.payment.findFirst({ where: { orderId, cashAmount: BigInt(due) } }),
      ).not.toBeNull();
      expect((await raw.visit.findUniqueOrThrow({ where: { id: visitId } })).status).toBe(
        'COMPLETED',
      );
    });

    it('quota épuisé : la vente est refusée, la demande perdue est enregistrée', async () => {
      const bimo = item('BIMO-CHOC');
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'C01', company: { code: 'CASHVAN-EST' } },
      });
      await raw.quota.create({
        data: {
          id: uuidv7(),
          companyId: user.companyId,
          userId: user.id,
          productVariantId: bimo.variantId,
          date: new Date(`${DAY}T00:00:00Z`),
          qty: bimo.baseQty,
          enteredQty: 1,
          enteredUnitId: bimo.unitId,
        },
      });
      const customer = customers[1]!;
      const visitId = await phones.startVisit(seller, customer.id, 'ON_SITE');
      const refused = await phones.send(seller, 'sale.confirm', {
        orderId: uuidv7(),
        number: number(),
        visitId,
        lines: [{ variantId: bimo.variantId, unitId: bimo.unitId, qty: 2 }],
        cashAmount: 0,
      });
      expect(refused.status).toBe('REJECTED');
      const lostDemandId = uuidv7();
      const lost = await phones.send(seller, 'lost_demand.create', {
        lostDemandId,
        customerId: customer.id,
        variantId: bimo.variantId,
        qty: bimo.baseQty,
      });
      expect(lost.status, JSON.stringify(lost)).toBe('APPLIED');
      expect(await raw.lostDemand.findUniqueOrThrow({ where: { id: lostDemandId } })).toMatchObject(
        {
          kind: 'LOST_DEMAND',
          qty: bimo.baseQty,
        },
      );
    });

    it('refuse de vendre avant le pointage du camion (BR-CV-02)', async () => {
      // C02 a un chargement validé mais pas encore pointé
      const c02 = await phones.get('C02', 'CASHVAN-EST');
      const started = await phones.send(c02, 'workday.start', { workdayId: uuidv7(), date: DAY });
      expect(started.status).toBe('APPLIED');
      const own = (await phones.today(c02, DAY)).body.day.customers;
      const visitId = await phones.startVisit(c02, own[0]!.id, 'ON_SITE');
      const bimo = item('BIMO-CHOC');
      const sale = await phones.send(c02, 'sale.confirm', {
        orderId: uuidv7(),
        number: `C02-${c02.series}2001`,
        visitId,
        lines: [{ variantId: bimo.variantId, unitId: bimo.unitId, qty: 1 }],
        cashAmount: 0,
      });
      expect(sale.status).toBe('REJECTED');
      expect(JSON.stringify(sale)).toContain('Pointez');
    });
  });
});
