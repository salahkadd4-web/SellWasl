import type {
  CustomerDto,
  InventoryDto,
  InventoryResult,
  ProductDto,
  ReceiptDto,
  StockAlertDto,
  StockMovementDto,
  StockRowDto,
} from '@sellwasl/validation';
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

  /** Entrepôt de test (camion sans conducteur par défaut), retiré à la fin de la suite. */
  async function testWarehouse(company: string, code: string, type: 'TRUCK' | 'DEPOT' = 'TRUCK') {
    const c = await raw.company.findFirstOrThrow({ where: { code: company } });
    const id = uuidv7();
    await raw.warehouse.create({
      data: { id, companyId: c.id, type, code, name: `Test ${code}` },
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

  describe('entrées, consultation, seuils (UC-40)', () => {
    let depotId: string;
    beforeAll(async () => {
      depotId = (
        await raw.warehouse.findFirstOrThrow({
          where: { company: { code: 'DISTRI-ORAN' }, type: 'DEPOT', code: 'DEPOT' },
        })
      ).id;
    });
    const physical = async (warehouseId: string, variantId: string) =>
      (await raw.stock.findFirst({ where: { warehouseId, productVariantId: variantId } }))
        ?.physicalQty ?? 0;

    it('enregistre une entrée en unité de base avec un mouvement IN', async () => {
      const thon = item('THON-TOM');
      const before = await physical(depotId, thon.variantId);
      const created = await call<ReceiptDto>(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: depotId,
          supplier: 'Conserverie du Sud',
          reference: 'BL-7781',
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 3 }],
        },
      });
      expect(created.status).toBe(201);
      expect(created.body.lines[0]).toMatchObject({ enteredQty: 3, qty: 3 * thon.baseQty });
      expect(await physical(depotId, thon.variantId)).toBe(before + 3 * thon.baseQty);
      const list = await call<ReceiptDto[]>(t.url, 'GET', '/stock/receipts', { token: sup });
      expect(list.body.map((r) => r.id)).toContain(created.body.id);
      const moves = await call<StockMovementDto[]>(
        t.url,
        'GET',
        `/stock/movements?type=IN&variantId=${thon.variantId}`,
        { token: sup },
      );
      expect(moves.body[0]).toMatchObject({
        type: 'IN',
        qty: 3 * thon.baseQty,
        sourceType: 'RECEIPT',
      });
    });

    it("crée la ligne de stock d'un article jamais entré dans ce dépôt", async () => {
      const second = await testWarehouse('DISTRI-ORAN', 'ZZ-DEPOT', 'DEPOT');
      const thon = item('THON-TOM');
      const created = await call(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: second.id,
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        },
      });
      expect(created.status).toBe(201);
      expect(await physical(second.id, thon.variantId)).toBe(thon.baseQty);
    });

    it("refuse l'unité d'un autre produit, un camion et le pré-vendeur", async () => {
      const thon = item('THON-TOM');
      const other = item('BIMO-CHOC');
      const wrongUnit = await call(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: depotId,
          lines: [{ variantId: thon.variantId, unitId: other.unitId, qty: 1 }],
        },
      });
      expect(wrongUnit.status).toBe(422);
      const truck = await raw.warehouse.findFirstOrThrow({
        where: { company: { code: 'DISTRI-ORAN' }, type: 'TRUCK', code: 'TRUCK-01' },
      });
      const toTruck = await call(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: truck.id,
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        },
      });
      expect(toTruck.status).toBe(422);
      const p = await phones.get('V07');
      const seller = await call(t.url, 'POST', '/stock/receipts', {
        token: p.token,
        body: {
          warehouseId: depotId,
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        },
      });
      expect(seller.status).toBe(403);
    });

    it('signale les articles sous leur seuil, sur la page Stock et dans les alertes', async () => {
      const thon = item('THON-TOM');
      const rows = await call<StockRowDto[]>(t.url, 'GET', `/stock?warehouseId=${depotId}`, {
        token: sup,
      });
      const row = rows.body.find((r) => r.variantId === thon.variantId)!;
      expect(row.available).toBe(row.physical - row.reserved);
      const put = (lowStockQty: number | null) =>
        call(t.url, 'PUT', '/stock/thresholds', {
          token: sup,
          body: { entries: [{ variantId: thon.variantId, lowStockQty }] },
        });
      expect((await put(row.available + 1)).status).toBe(200);
      const after = await call<StockRowDto[]>(t.url, 'GET', `/stock?warehouseId=${depotId}`, {
        token: sup,
      });
      expect(after.body.find((r) => r.variantId === thon.variantId)).toMatchObject({
        isLow: true,
        lowStockQty: row.available + 1,
      });
      const alerts = await call<StockAlertDto[]>(t.url, 'GET', '/stock/alerts', { token: sup });
      expect(alerts.body).toContainEqual(
        expect.objectContaining({
          variantId: thon.variantId,
          warehouse: expect.objectContaining({ id: depotId }),
        }),
      );
      expect((await put(null)).status).toBe(200);
      const cleared = await call<StockAlertDto[]>(t.url, 'GET', '/stock/alerts', { token: sup });
      expect(cleared.body.map((a) => a.variantId)).not.toContain(thon.variantId);
    });
  });

  describe('inventaire (UC-44)', () => {
    let depotId: string;
    const base = (ref: string) => {
      const product = products.find((p) => p.variants.some((v) => v.reference === ref))!;
      return {
        variantId: product.variants.find((v) => v.reference === ref)!.id,
        unitId: product.units.find((u) => u.isBase)!.id,
      };
    };
    const stockOf = (variantId: string) =>
      raw.stock.findFirstOrThrow({ where: { warehouseId: depotId, productVariantId: variantId } });
    const newDraft = () =>
      call<InventoryDto>(t.url, 'POST', '/inventories', {
        token: sup,
        body: { warehouseId: depotId },
      });
    const count = (id: string, lines: { variantId: string; unitId: string; qty: number }[]) =>
      call<InventoryDto>(t.url, 'PUT', `/inventories/${id}/lines`, { token: sup, body: { lines } });
    const validate = (id: string) =>
      call<InventoryResult>(t.url, 'POST', `/inventories/${id}/validate`, { token: sup });
    /** Remet le physique d'un article à sa valeur d'avant le test. */
    async function restore(ref: string, physical: number) {
      const now = (await stockOf(base(ref).variantId)).physicalQty;
      if (now < physical)
        await call(t.url, 'POST', '/stock/receipts', {
          token: sup,
          body: { warehouseId: depotId, lines: [{ ...base(ref), qty: physical - now }] },
        });
    }

    beforeAll(async () => {
      depotId = (
        await raw.warehouse.findFirstOrThrow({
          where: { company: { code: 'DISTRI-ORAN' }, type: 'DEPOT', code: 'DEPOT' },
        })
      ).id;
    });

    it('ajuste sur le stock du moment de la validation ; les articles non comptés ne changent pas', async () => {
      const thon = base('THON-TOM');
      const bimo = await stockOf(base('BIMO-CHOC').variantId);
      const before = await stockOf(thon.variantId);
      const draft = await newDraft();
      expect(draft.status).toBe(201);
      expect(draft.body.status).toBe('DRAFT');
      expect((await newDraft()).status).toBe(422);

      const counted = before.physicalQty + 5;
      const saved = await count(draft.body.id, [{ ...thon, qty: counted }]);
      expect(saved.body.lines).toEqual([
        expect.objectContaining({
          variantId: thon.variantId,
          countedQty: counted,
          expectedQty: before.physicalQty,
        }),
      ]);
      // Une entrée arrive entre le comptage et la validation : l'attendu suit le stock réel
      const carton = item('THON-TOM');
      await call(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: depotId,
          lines: [{ variantId: carton.variantId, unitId: carton.unitId, qty: 1 }],
        },
      });
      const result = await validate(draft.body.id);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ adjustments: 1, releasedLines: [] });
      expect((await stockOf(thon.variantId)).physicalQty).toBe(counted);
      const adjustment = await raw.stockMovement.findFirstOrThrow({
        where: { type: 'ADJUSTMENT', sourceType: 'INVENTORY', sourceId: draft.body.id },
      });
      expect(adjustment).toMatchObject({ qty: carton.baseQty - 5, fromWarehouseId: depotId });
      expect((await stockOf(base('BIMO-CHOC').variantId)).physicalQty).toBe(bimo.physicalQty);
      expect((await validate(draft.body.id)).status).toBe(422);
      await restore('THON-TOM', before.physicalQty);
    });

    it('réduit les réservations des commandes les plus récentes quand le compté passe sous le réservé', async () => {
      const huile = base('THON-HUI');
      const p = await phones.get('V08');
      await phones.startDay(p, DAY);
      const customer = await detailCustomer(p, DAY);
      const visitId = await phones.startVisit(p, customer.id, 'PHONE');
      const orderId = uuidv7();
      const number = `V08-${p.series}0902`;
      const carton = item('THON-HUI');
      const confirmed = await phones.send(p, 'order.confirm', {
        orderId,
        number,
        visitId,
        lines: [{ variantId: carton.variantId, unitId: carton.unitId, qty: 2 }],
      });
      expect(confirmed.status).toBe('APPLIED');
      const before = await stockOf(huile.variantId);
      expect(before.reservedQty).toBeGreaterThanOrEqual(2 * carton.baseQty);

      const draft = await newDraft();
      await count(draft.body.id, [{ ...huile, qty: before.reservedQty - 2 }]);
      const result = await validate(draft.body.id);
      expect(result.status).toBe(200);
      expect(result.body.releasedLines).toEqual([
        {
          orderNumber: number,
          customerName: customer.name,
          variantId: huile.variantId,
          released: 2,
        },
      ]);
      const after = await stockOf(huile.variantId);
      expect(after).toMatchObject({
        physicalQty: before.reservedQty - 2,
        reservedQty: before.reservedQty - 2,
      });
      const line = await raw.orderLine.findFirstOrThrow({ where: { orderId, kind: 'NORMAL' } });
      expect(line).toMatchObject({ reservedQty: 2 * carton.baseQty - 2, isStockout: true });
      await restore('THON-HUI', before.physicalQty);
    });

    it('supprime un brouillon', async () => {
      const draft = await newDraft();
      expect(
        (await call(t.url, 'DELETE', `/inventories/${draft.body.id}`, { token: sup })).status,
      ).toBe(204);
      const list = await call<InventoryDto[]>(t.url, 'GET', '/inventories', { token: sup });
      expect(list.body.map((i) => i.id)).not.toContain(draft.body.id);
    });
  });
});
