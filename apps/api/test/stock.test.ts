import type { CustomerDto, ProductDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockLedger } from '../src/stock/stock-ledger.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedis réservés à cette suite : aucune autre n'y travaille. */
const DAY = '2027-01-09';

/** Entrepôt et stock (phase 17). */
describe('stock (phase 17)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let phones: Phones;
  let products: ProductDto[];
  const testWarehouses: string[] = [];

  /** Article d'un produit du seed : parfum (référence) et unité (nom). */
  function item(variantReference: string, unitName = 'carton') {
    const product = products.find((p) => p.variants.some((v) => v.reference === variantReference))!;
    expect(product, variantReference).toBeTruthy();
    const unit = product.units.find((u) => u.name === unitName)!;
    return {
      variantId: product.variants.find((v) => v.reference === variantReference)!.id,
      unitId: unit.id,
      baseQty: unit.baseQty,
    };
  }

  async function detailCustomer(p: Phone, date: string) {
    const day = (await phones.today(p, date)).body.day;
    for (const c of day.customers) {
      const fiche = await call<CustomerDto>(t.url, 'GET', `/customers/${c.id}`, { token: sup });
      if (fiche.body.customerType.code === 'DETAIL') return fiche.body;
    }
    throw new Error('Aucun client Détail ce jour-là');
  }

  /** Entrepôt de test (camion sans conducteur), retiré à la fin de la suite. */
  async function testWarehouse(company: string, code: string) {
    const c = await raw.company.findFirstOrThrow({ where: { code: company } });
    const id = uuidv7();
    await raw.warehouse.create({
      data: { id, companyId: c.id, type: 'TRUCK', code, name: `Test ${code}` },
    });
    testWarehouses.push(id);
    return { id, companyId: c.id };
  }

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;
  });
  afterAll(async () => {
    // Commandes annulées : modules.test.ts change le mode, ce qu'une commande non livrée empêche
    await raw.order.updateMany({
      where: { company: { code: 'DISTRI-ORAN' }, orderDate: new Date(`${DAY}T00:00:00Z`) },
      data: { status: 'CANCELLED' },
    });
    await raw.warehouse.updateMany({
      where: { id: { in: testWarehouses } },
      data: { isActive: false, deletedAt: new Date() },
    });
    await t.close();
  });

  describe('données', () => {
    it("l'admin et le superviseur peuvent faire les opérations de stock sur le Web", async () => {
      const me = await call<{ permissions: string[] }>(t.url, 'GET', '/me', { token: sup });
      expect(me.body.permissions).toEqual(
        expect.arrayContaining([
          'stock.receive',
          'inventory.count',
          'loads.load',
          'unloads.validate',
        ]),
      );
    });

    it("les motifs d'écart de déchargement existent", async () => {
      const labels = await raw.reason.findMany({
        where: { company: { code: 'DISTRI-ORAN' }, kind: 'ADJUSTMENT' },
        select: { label: true },
      });
      expect(labels.map((r) => r.label)).toEqual(
        expect.arrayContaining(['Retour client', 'Marchandise manquante']),
      );
    });
  });

  describe('registre', () => {
    it('une réservation et sa libération laissent un mouvement', async () => {
      const p = await phones.get('V07');
      await phones.startDay(p, DAY);
      const customer = await detailCustomer(p, DAY);
      const visitId = await phones.startVisit(p, customer.id, 'PHONE');
      const orderId = uuidv7();
      const thon = item('THON-TOM');
      const confirmed = await phones.send(p, 'order.confirm', {
        orderId,
        number: `V07-${p.series}0901`,
        visitId,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
      });
      expect(confirmed.status).toBe('APPLIED');
      const reservation = await raw.stockMovement.findFirst({
        where: { type: 'RESERVATION', sourceType: 'ORDER', sourceId: orderId },
      });
      expect(reservation).toMatchObject({ qty: thon.baseQty, productVariantId: thon.variantId });

      expect((await phones.send(p, 'order.cancel', { orderId })).status).toBe('APPLIED');
      const release = await raw.stockMovement.findFirst({
        where: { type: 'RELEASE', sourceType: 'ORDER', sourceId: orderId },
      });
      expect(release).toMatchObject({
        qty: thon.baseQty,
        fromWarehouseId: reservation!.toWarehouseId,
      });
    });

    it('deux transferts simultanés ne dépassent jamais le stock (BR-STK-04, BR-STK-05)', async () => {
      const ledger = t.app.get(StockLedger);
      const a = await testWarehouse('DISTRI-ORAN', 'TST-A');
      const b = await testWarehouse('DISTRI-ORAN', 'TST-B');
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'A-SUP', company: { code: 'DISTRI-ORAN' } },
      });
      const actor = { companyId: a.companyId, userId: user.id };
      const variantId = item('THON-TOM').variantId;
      await raw.$transaction((tx) =>
        ledger.apply(tx, actor, [{ type: 'IN', variantId, qty: 10, toWarehouseId: a.id }]),
      );
      const transfer = () =>
        raw.$transaction((tx) =>
          ledger.apply(tx, actor, [
            { type: 'TRANSFER', variantId, qty: 10, fromWarehouseId: a.id, toWarehouseId: b.id },
          ]),
        );
      const results = await Promise.allSettled([transfer(), transfer()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(String(failed.reason.message)).toMatch(/Stock insuffisant/);
      const stock = await raw.stock.findMany({
        where: { productVariantId: variantId, warehouseId: { in: [a.id, b.id] } },
      });
      expect(stock.find((s) => s.warehouseId === a.id)?.physicalQty).toBe(0);
      expect(stock.find((s) => s.warehouseId === b.id)?.physicalQty).toBe(10);
      expect(
        await raw.stockMovement.count({ where: { type: 'TRANSFER', fromWarehouseId: a.id } }),
      ).toBe(1);
    });
  });
});
