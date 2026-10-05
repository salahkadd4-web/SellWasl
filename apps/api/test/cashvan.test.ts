import type { LoadDto, ProductDto, TruckCheckLine, TruckStockDto } from '@sellwasl/validation';
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
});
