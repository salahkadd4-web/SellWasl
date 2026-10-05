import type {
  CustomerDto,
  InventoryDto,
  InventoryResult,
  LoadDto,
  PendingUnloadDto,
  UnloadDto,
  UnloadPreviewLine,
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

  /**
   * Change des règles P-xx d'une entreprise le temps d'un test (nouvelle version des paramètres,
   * supprimée ensuite).
   */
  async function withRules(
    company: string,
    rules: Record<string, boolean>,
    fn: () => Promise<void>,
  ) {
    const latest = await raw.companySettings.findFirstOrThrow({
      where: { company: { code: company } },
      orderBy: { version: 'desc' },
    });
    const data = latest.data as { rules?: Record<string, boolean> };
    const row = await raw.companySettings.create({
      data: {
        id: uuidv7(),
        companyId: latest.companyId,
        version: latest.version + 1,
        data: { ...data, rules: { ...data.rules, ...rules } },
      },
    });
    try {
      await fn();
    } finally {
      await raw.companySettings.delete({ where: { id: row.id } });
    }
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
    // Journées des pré-vendeurs clôturées : une journée en cours bloque les autres suites
    // (nouvelle journée, position des appareils, changement de mode)
    await raw.workday.updateMany({
      where: { company: { code: 'DISTRI-ORAN' }, date: new Date(`${DAY}T00:00:00Z`) },
      data: { status: 'CLOSED', closedAt: new Date() },
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

  describe('chargement des camions (UC-42)', () => {
    const LOAD_DAY = '2027-01-11';
    let supB: string;
    let productsB: ProductDto[];
    const itemB = (ref: string) => {
      const product = productsB.find((p) => p.variants.some((v) => v.reference === ref))!;
      const unit = product.units.find((u) => u.name === 'carton')!;
      return {
        variantId: product.variants.find((v) => v.reference === ref)!.id,
        unitId: unit.id,
        baseQty: unit.baseQty,
      };
    };
    const truckOf = (company: string, code: string) =>
      raw.warehouse.findFirstOrThrow({ where: { company: { code: company }, code } });
    const load = (token: string, body: Record<string, unknown>) =>
      call<LoadDto>(t.url, 'POST', '/loads', { token, body: { date: LOAD_DAY, ...body } });

    beforeAll(async () => {
      supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
      productsB = (
        await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supB })
      ).body;
    });

    it('charge le camion du vendeur cash van, puis le recharge selon P-07', async () => {
      const truck = await truckOf('CASHVAN-EST', 'TRUCK-01');
      const thon = itemB('THON-TOM');
      const before =
        (
          await raw.stock.findFirst({
            where: { warehouseId: truck.id, productVariantId: thon.variantId },
          })
        )?.physicalQty ?? 0;
      const lines = [{ variantId: thon.variantId, unitId: thon.unitId, qty: 2 }];
      const first = await load(supB, { truckId: truck.id, lines });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({
        kind: 'CASH_VAN',
        status: 'LOADED',
        user: expect.objectContaining({ code: 'C01' }),
      });
      expect(first.body.lines).toEqual([
        expect.objectContaining({ variantId: thon.variantId, qty: 2 * thon.baseQty }),
      ]);
      const after = await raw.stock.findFirstOrThrow({
        where: { warehouseId: truck.id, productVariantId: thon.variantId },
      });
      expect(after.physicalQty).toBe(before + 2 * thon.baseQty);
      expect(
        await raw.stockMovement.count({
          where: {
            type: 'TRANSFER',
            sourceType: 'LOAD',
            sourceId: first.body.id,
            toWarehouseId: truck.id,
          },
        }),
      ).toBe(1);

      const second = await load(supB, { truckId: truck.id, lines });
      expect(second.body.kind).toBe('RELOAD');
      await withRules('CASHVAN-EST', { P07_multipleCashVanLoads: false }, async () => {
        expect((await load(supB, { truckId: truck.id, lines })).status).toBe(422);
      });
      const list = await call<LoadDto[]>(t.url, 'GET', `/loads?date=${LOAD_DAY}`, { token: supB });
      expect(list.body.map((l) => l.id)).toEqual(
        expect.arrayContaining([first.body.id, second.body.id]),
      );
    });

    it('charge le camion du livreur en tournée', async () => {
      const truck = await truckOf('DISTRI-ORAN', 'TRUCK-01');
      const thon = item('THON-TOM');
      const created = await load(sup, {
        truckId: truck.id,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
      });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        kind: 'ROUTE',
        user: expect.objectContaining({ code: 'L01' }),
      });
    });

    it('refuse au-delà du disponible du dépôt sans rien écrire, et un camion sans conducteur', async () => {
      const truck = await truckOf('CASHVAN-EST', 'TRUCK-02');
      const thon = itemB('THON-TOM');
      const depot = await raw.warehouse.findFirstOrThrow({
        where: { company: { code: 'CASHVAN-EST' }, type: 'DEPOT' },
      });
      const stock = await raw.stock.findFirstOrThrow({
        where: { warehouseId: depot.id, productVariantId: thon.variantId },
      });
      const cartons = Math.floor((stock.physicalQty - stock.reservedQty) / thon.baseQty) + 1;
      const loadsBefore = await raw.load.count({ where: { truckId: truck.id } });
      const movesBefore = await raw.stockMovement.count({ where: { toWarehouseId: truck.id } });
      const refused = await load(supB, {
        truckId: truck.id,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: cartons }],
      });
      expect(refused.status).toBe(422);
      expect(await raw.load.count({ where: { truckId: truck.id } })).toBe(loadsBefore);
      expect(await raw.stockMovement.count({ where: { toWarehouseId: truck.id } })).toBe(
        movesBefore,
      );

      const orphan = await testWarehouse('DISTRI-ORAN', 'TST-NODRIVER');
      const noDriver = await load(sup, {
        truckId: orphan.id,
        lines: [{ variantId: item('THON-TOM').variantId, unitId: item('THON-TOM').unitId, qty: 1 }],
      });
      expect(noDriver.status).toBe(422);
    });
  });

  describe('déchargement des camions (UC-43)', () => {
    let supB: string;
    const reason = async (label: string) =>
      (
        await raw.reason.findFirstOrThrow({
          where: { company: { code: 'CASHVAN-EST' }, kind: 'ADJUSTMENT', label },
        })
      ).id;
    /** Journée du conducteur créée directement en base, clôturée sauf demande contraire. */
    async function workdayOf(
      userCode: string,
      date: string,
      status: 'CLOSED' | 'IN_PROGRESS' = 'CLOSED',
    ) {
      const user = await raw.user.findFirstOrThrow({
        where: { code: userCode, company: { code: 'CASHVAN-EST' } },
      });
      const id = uuidv7();
      await raw.workday.create({
        data: {
          id,
          companyId: user.companyId,
          userId: user.id,
          date: new Date(`${date}T00:00:00Z`),
          status,
          startedAt: new Date(`${date}T07:00:00Z`),
          closedAt: status === 'CLOSED' ? new Date(`${date}T17:00:00Z`) : null,
          settingsVersion: 1,
        },
      });
      return id;
    }
    const preview = async (workdayId: string) =>
      (
        await call<UnloadPreviewLine[]>(t.url, 'GET', `/unloads/preview?workdayId=${workdayId}`, {
          token: supB,
        })
      ).body;
    const unload = (workdayId: string, lines: unknown[]) =>
      call<UnloadDto>(t.url, 'POST', '/unloads', { token: supB, body: { workdayId, lines } });
    const truckStock = async (code: string) => {
      const truck = await raw.warehouse.findFirstOrThrow({
        where: { company: { code: 'CASHVAN-EST' }, code },
      });
      return raw.stock.findMany({ where: { warehouseId: truck.id } });
    };

    beforeAll(async () => {
      supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    });

    it('enregistre un surplus et un manquant, renvoie le compté au dépôt et bloque la réouverture', async () => {
      const workdayId = await workdayOf('C01', '2027-01-11');
      const pending = await call<PendingUnloadDto[]>(t.url, 'GET', '/unloads/pending', {
        token: supB,
      });
      expect(pending.body).toContainEqual(
        expect.objectContaining({ workdayId, user: expect.objectContaining({ code: 'C01' }) }),
      );

      const lines = await preview(workdayId);
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines) expect(l.loaded).toBe(l.theoretical + l.delivered + l.free);
      const [surplus, missing, ...rest] = lines.filter((l) => l.theoretical > 0);
      const body = [
        {
          variantId: surplus!.variantId,
          countedQty: surplus!.theoretical + 2,
          reasonId: await reason('Retour client'),
        },
        {
          variantId: missing!.variantId,
          countedQty: missing!.theoretical - 1,
          reasonId: await reason('Marchandise manquante'),
        },
        ...rest.map((l) => ({ variantId: l.variantId, countedQty: l.theoretical })),
        ...lines
          .filter((l) => l.theoretical === 0)
          .map((l) => ({ variantId: l.variantId, countedQty: 0 })),
      ];

      // Un écart sans motif, ou un article oublié, est refusé
      expect(
        (
          await unload(
            workdayId,
            body.map((b, i) => (i === 0 ? { ...b, reasonId: undefined } : b)),
          )
        ).status,
      ).toBe(422);
      expect((await unload(workdayId, body.slice(1))).status).toBe(422);

      const done = await unload(workdayId, body);
      expect(done.status).toBe(201);
      expect(done.body).toMatchObject({ hasGap: true, keepsStockInTruck: false });
      expect(done.body.lines.find((l) => l.variantId === surplus!.variantId)).toMatchObject({
        gap: 2,
      });
      expect(done.body.lines.find((l) => l.variantId === missing!.variantId)).toMatchObject({
        gap: -1,
      });
      const adjustments = await raw.stockMovement.findMany({
        where: { type: 'ADJUSTMENT', sourceType: 'UNLOAD', sourceId: done.body.id },
      });
      expect(adjustments).toHaveLength(2);
      expect(adjustments.find((m) => m.productVariantId === surplus!.variantId)).toMatchObject({
        qty: 2,
        fromWarehouseId: null,
      });
      expect(adjustments.find((m) => m.productVariantId === missing!.variantId)).toMatchObject({
        qty: 1,
        toWarehouseId: null,
      });
      expect((await truckStock('TRUCK-01')).every((s) => s.physicalQty === 0)).toBe(true);

      expect((await unload(workdayId, body)).status).toBe(422);
      const reopen = await call(t.url, 'POST', `/workdays/${workdayId}/reopen`, {
        token: supB,
        body: { reason: 'Erreur de saisie' },
      });
      expect(reopen.status).toBe(409);
      const list = await call<UnloadDto[]>(t.url, 'GET', '/unloads?date=2027-01-11', {
        token: supB,
      });
      expect(list.body.map((u) => u.id)).toContain(done.body.id);
    });

    it('refuse une journée en cours', async () => {
      const workdayId = await workdayOf('C02', '2027-01-13', 'IN_PROGRESS');
      expect((await unload(workdayId, [])).status).toBe(422);
      await raw.workday.update({
        where: { id: workdayId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    it('garde le compté dans le camion quand P-06 le demande', async () => {
      const workdayId = await workdayOf('C02', '2027-01-12');
      const lines = await preview(workdayId);
      await withRules('CASHVAN-EST', { P06_fullUnload: false }, async () => {
        const done = await unload(
          workdayId,
          lines.map((l) => ({ variantId: l.variantId, countedQty: l.theoretical })),
        );
        expect(done.status).toBe(201);
        expect(done.body).toMatchObject({ keepsStockInTruck: true, hasGap: false });
      });
      const stock = await truckStock('TRUCK-02');
      for (const l of lines)
        expect(stock.find((s) => s.productVariantId === l.variantId)?.physicalQty ?? 0).toBe(
          l.theoretical,
        );
    });
  });
});
