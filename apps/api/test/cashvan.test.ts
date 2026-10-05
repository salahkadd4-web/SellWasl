import type {
  DaySummaryDto,
  DebtorDto,
  LoadDto,
  PaymentRowDto,
  ProductDto,
  ReceiptPrintDto,
  SettlementRowDto,
  TruckCheckLine,
  TruckStockDto,
  VisitCatalog,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { StockLedger } from '../src/stock/stock-ledger.service';
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
    // Marchandise restée dans le camion la veille (P-06), quel que soit l'ordre des suites
    const ledger = t.app.get(StockLedger);
    const storekeeper = await raw.user.findFirstOrThrow({
      where: { code: 'B-SUP', company: { code: 'CASHVAN-EST' } },
    });
    await raw.$transaction((tx) =>
      ledger.apply(tx, { companyId: storekeeper.companyId, userId: storekeeper.id }, [
        {
          type: 'ADJUSTMENT',
          variantId: item('BIMO-CHOC').variantId,
          qty: 48,
          toWarehouseId: truckId,
        },
      ]),
    );
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
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 2 }],
        },
      });
      expect(loaded.status).toBe(201);
      const lines = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: seller.token })
      ).body;
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.find((l) => l.variantId === thon.variantId)).toMatchObject({
        toReceive: 2 * thon.baseQty,
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

  describe('bons, réimpression et récapitulatif (UC-34, UC-35, BR-IMP-03, BR-PAY-07)', () => {
    it('liste les bons du jour avec de quoi les imprimer', async () => {
      const receipts = await call<ReceiptPrintDto[]>(t.url, 'GET', `/me/receipts?date=${DAY}`, {
        token: seller.token,
      });
      expect(receipts.status).toBe(200);
      const sale = receipts.body.find((r) => r.kind === 'SALE')!;
      expect(sale).toMatchObject({ reprints: 0, credit: 0 });
      expect(sale.paid).toBe(sale.total);
      expect(sale.lines.find((l) => !l.free)).toMatchObject({ qty: 1, unitName: 'carton' });
    });

    it('trace chaque réimpression ; un bon inconnu est refusé', async () => {
      const [sale] = (
        await call<ReceiptPrintDto[]>(t.url, 'GET', `/me/receipts?date=${DAY}`, {
          token: seller.token,
        })
      ).body;
      const reprint = await phones.send(seller, 'receipt.reprint', { number: sale!.number });
      expect(reprint.status, JSON.stringify(reprint)).toBe('APPLIED');
      const after = (
        await call<ReceiptPrintDto[]>(t.url, 'GET', `/me/receipts?date=${DAY}`, {
          token: seller.token,
        })
      ).body.find((r) => r.number === sale!.number)!;
      expect(after.reprints).toBe(1);
      expect((await phones.send(seller, 'receipt.reprint', { number: 'C01-Z9999' })).status).toBe(
        'REJECTED',
      );
    });

    it('récapitulatif de journée : montant attendu = espèces encaissées', async () => {
      const summary = await call<DaySummaryDto>(t.url, 'GET', '/me/day-summary', {
        token: seller.token,
      });
      expect(summary.status).toBe(200);
      expect(summary.body.receipts).toBeGreaterThanOrEqual(1);
      expect(summary.body.expected).toBe(summary.body.cashSales + summary.body.cashDebts);
      expect(summary.body.expected).toBeGreaterThan(0);
    });
  });

  describe('versements et comptabilité (UC-70, UC-71, BR-PAY-08)', () => {
    let accountant: string;
    let expected: number;

    beforeAll(async () => {
      accountant = await webLogin(t.url, 'CASHVAN-EST', 'B-CPT');
    });

    it('refuse un versement tant que la journée est en cours', async () => {
      const refused = await call(t.url, 'POST', '/settlements', {
        token: accountant,
        body: { workdayId, remittedAmount: 0 },
      });
      expect(refused.status).toBe(422);
    });

    it('récapitulatif sur le Web, puis versement avec écart, une seule fois', async () => {
      // La visite de la demande perdue est restée ouverte : on la termine avant la clôture
      await raw.visit.updateMany({
        where: { workdayId, status: 'IN_PROGRESS' },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await phones.closeDay(seller, workdayId);
      const summary = await call<DaySummaryDto>(t.url, 'GET', `/workdays/${workdayId}/summary`, {
        token: supB,
      });
      expect(summary.status).toBe(200);
      expected = summary.body.expected;
      const rows = await call<SettlementRowDto[]>(t.url, 'GET', `/settlements?date=${DAY}`, {
        token: accountant,
      });
      expect(rows.body.find((r) => r.workdayId === workdayId)).toMatchObject({
        expected,
        remitted: null,
        gap: null,
      });
      const settled = await call<SettlementRowDto>(t.url, 'POST', '/settlements', {
        token: accountant,
        body: { workdayId, remittedAmount: expected - 500 },
      });
      expect(settled.status, JSON.stringify(settled.body)).toBe(201);
      expect(settled.body).toMatchObject({ expected, remitted: expected - 500, gap: -500 });
      const again = await call(t.url, 'POST', '/settlements', {
        token: accountant,
        body: { workdayId, remittedAmount: expected },
      });
      expect(again.status).toBe(409);
      expect(
        (
          await call(t.url, 'POST', '/settlements', {
            token: seller.token,
            body: { workdayId, remittedAmount: 1 },
          })
        ).status,
      ).toBe(403);
    });

    it('dettes des clients, paiements et export CSV', async () => {
      const debtors = await call<DebtorDto[]>(t.url, 'GET', '/debtors', { token: accountant });
      expect(debtors.status).toBe(200);
      expect(debtors.body.every((d) => d.debtAmount > 0)).toBe(true);
      const payments = await call<PaymentRowDto[]>(
        t.url,
        'GET',
        `/payments?from=${DAY}&to=${DAY}`,
        { token: accountant },
      );
      const sale = payments.body.find((p) => p.kind === 'DELIVERY_PAYMENT')!;
      expect(sale).toBeTruthy();
      const csv = await fetch(`${t.url}/payments/export?from=${DAY}&to=${DAY}`, {
        headers: { Authorization: `Bearer ${accountant}` },
      });
      expect(csv.status).toBe(200);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      expect(await csv.text()).toContain(sale.number);
    });

    it("neutralise une formule dans l'export CSV (injection de formule)", async () => {
      const payment = await raw.payment.findFirstOrThrow({
        where: { workdayId, kind: 'DELIVERY_PAYMENT' },
        include: { customer: true },
      });
      await raw.customer.update({
        where: { id: payment.customerId },
        data: { name: '=HYPERLINK("http://x")' },
      });
      try {
        const csv = await fetch(`${t.url}/payments/export?from=${DAY}&to=${DAY}`, {
          headers: { Authorization: `Bearer ${accountant}` },
        });
        const text = await csv.text();
        expect(text).not.toMatch(/;"?=HYPERLINK/);
        expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
      } finally {
        await raw.customer.update({
          where: { id: payment.customerId },
          data: { name: payment.customer.name },
        });
      }
    });
  });
});
