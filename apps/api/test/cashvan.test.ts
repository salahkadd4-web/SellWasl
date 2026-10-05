import type { ProductDto, TruckCheckLine, TruckStockDto } from '@sellwasl/validation';
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
});
