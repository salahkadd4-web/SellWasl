import {
  applyOps,
  buildOrder,
  HttpError,
  loadState,
  type LocalState,
  MemoryStore,
  NetworkError,
  type PullQuery,
  SyncEngine,
  type Transport,
  todayView,
  truckStockView,
  visitCatalogView,
} from '@sellwasl/offline';
import type {
  OfflineKind,
  ProductDto,
  SyncOperationInput,
  SyncPullResponse,
  SyncPushResponse,
  TodayResponse,
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
const DAY = '2027-06-12';

/**
 * Critères de validation de la phase 23, de bout en bout : le moteur du téléphone
 * (`@sellwasl/offline`) branché sur l'API de test, avec un réseau qu'on coupe.
 */
describe('hors connexion de bout en bout (phase 23)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let phones: Phones;
  let products: ProductDto[];

  /** Réseau du téléphone : coupé, ou réponse perdue une fois. */
  class TestTransport implements Transport {
    offline = false;
    loseNextResponse = false;
    constructor(private readonly p: Phone) {}

    async push(operations: SyncOperationInput[]): Promise<SyncPushResponse> {
      if (this.offline) throw new NetworkError('Serveur injoignable.');
      const reply = await call<SyncPushResponse>(t.url, 'POST', '/sync/push', {
        token: this.p.token,
        body: { deviceId: this.p.deviceId, operations },
      });
      if (reply.status !== 200)
        throw new HttpError(reply.status, reply.body.error?.code ?? 'ERROR', 'Erreur');
      if (this.loseNextResponse) {
        this.loseNextResponse = false;
        throw new NetworkError('Réponse perdue.');
      }
      return reply.body;
    }

    async pull(q: PullQuery): Promise<SyncPullResponse> {
      if (this.offline) throw new NetworkError('Serveur injoignable.');
      const params = new URLSearchParams({ cursor: q.cursor, date: q.date });
      if (q.scope !== undefined) params.set('scope', q.scope);
      if (q.page) params.set('page', q.page);
      const reply = await call<SyncPullResponse>(t.url, 'GET', `/sync/pull?${params.toString()}`, {
        token: this.p.token,
      });
      if (reply.status !== 200)
        throw new HttpError(reply.status, reply.body.error?.code ?? 'ERROR', 'Erreur');
      return reply.body;
    }
  }

  /** Téléphone complet : base en mémoire, moteur, réseau simulé. */
  async function device(code: string, company = 'DISTRI-ORAN') {
    const p = await phones.get(code, company);
    const store = new MemoryStore();
    const transport = new TestTransport(p);
    const engine = new SyncEngine({ store, transport, newId: uuidv7, today: () => DAY });
    // Opérations déjà envoyées par ce téléphone dans le fichier : le numéro d'ordre continue
    await store.setMeta('deviceSeq', String(p.seq));
    const local = async (): Promise<LocalState> => {
      const kinds = [...store.records.keys()] as OfflineKind[];
      const rows = Object.fromEntries(
        await Promise.all(kinds.map(async (k) => [k, await store.rows(k)])),
      );
      return applyOps(loadState(rows), await store.outbox());
    };
    return { p, store, transport, engine, local };
  }

  const item = (reference: string, unitName: string) => {
    const product = products.find((x) => x.variants.some((v) => v.reference === reference))!;
    return {
      variantId: product.variants.find((v) => v.reference === reference)!.id,
      unit: product.units.find((u) => u.name === unitName)!,
    };
  };

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    const supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    const supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': supA, 'CASHVAN-EST': supB });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supA }))
      .body;
  });
  afterAll(async () => {
    await raw.order.updateMany({
      where: { orderDate: new Date(`${DAY}T00:00:00Z`), status: { in: ['CONFIRMED', 'LOCKED'] } },
      data: { status: 'CANCELLED' },
    });
    await raw.visit.updateMany({
      where: { date: new Date(`${DAY}T00:00:00Z`), status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await raw.workday.updateMany({
      where: { date: new Date(`${DAY}T00:00:00Z`), status: 'IN_PROGRESS' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await t.close();
  });

  describe('pré-vendeur', () => {
    let d: Awaited<ReturnType<typeof device>>;
    let quotaId: string;
    const thon = () => item('THON-TOM', 'carton');

    /** Client du jour qui a un prix pour le thon en carton. */
    async function orderable(skip: string[] = []) {
      const local = await d.local();
      const day = todayView(local, DAY).day;
      for (const c of day.customers) {
        if (skip.includes(c.id)) continue;
        try {
          buildOrder(local, {
            customerTypeId: local.customers.get(c.id)!.customerType.id,
            date: DAY,
            lines: [{ variantId: thon().variantId, unitId: thon().unit.id, qty: 1 }],
            cashVan: false,
          });
          return c.id;
        } catch {
          // Pas de prix pour ce type : client suivant
        }
      }
      throw new Error('Aucun client du jour avec un prix pour le thon');
    }

    /** Commande calculée sur le téléphone puis mise en file. */
    async function queueOrder(customerId: string, cartons: number) {
      const visitId = uuidv7();
      await d.engine.enqueue('visit.start', { visitId, customerId, mode: 'PHONE' }, null);
      const local = await d.local();
      const lines = [{ variantId: thon().variantId, unitId: thon().unit.id, qty: cartons }];
      const built = buildOrder(local, {
        customerTypeId: local.customers.get(customerId)!.customerType.id,
        date: DAY,
        lines,
        cashVan: false,
      });
      const number = `V07-${d.p.series}9${String(cartons).padStart(3, '0')}`;
      const op = await d.engine.enqueue(
        'order.confirm',
        { orderId: uuidv7(), number, visitId, lines, expected: built.expected },
        null,
      );
      return { op, number, built };
    }

    beforeAll(async () => {
      d = await device('V07');
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'V07', company: { code: 'DISTRI-ORAN' } },
      });
      quotaId = uuidv7();
      await raw.quota.create({
        data: {
          id: quotaId,
          companyId: user.companyId,
          userId: user.id,
          productVariantId: thon().variantId,
          date: new Date(`${DAY}T00:00:00Z`),
          qty: 10 * thon().unit.baseQty,
          enteredQty: 10,
          enteredUnitId: thon().unit.id,
        },
      });
      expect((await d.engine.sync()).ok).toBe(true);
    });

    it('parité : la journée et le catalogue de visite locaux égalent ceux du serveur', async () => {
      const local = await d.local();
      const mine = todayView(local, DAY);
      const server = (
        await call<TodayResponse>(t.url, 'GET', `/me/today?date=${DAY}`, { token: d.p.token })
      ).body;
      expect(mine.day.customers.map((c) => c.id)).toEqual(server.day.customers.map((c) => c.id));
      expect(mine.counters).toEqual(server.counters);
      expect(mine.workday).toEqual(server.workday);
      expect(mine.rules).toEqual(server.rules);
      expect(mine.seller).toEqual(server.seller);

      const customerId = await orderable();
      const catalog = visitCatalogView(local, customerId, DAY);
      const remote = (
        await call<VisitCatalog>(
          t.url,
          'GET',
          `/me/visit-catalog?customerId=${customerId}&date=${DAY}`,
          { token: d.p.token },
        )
      ).body;
      const shape = (c: VisitCatalog) =>
        c.products.map((p) => ({
          id: p.id,
          units: p.units.map((u) => u.id),
          variants: p.variants.map((v) => [v.id, v.quotaRemaining]),
        }));
      expect(shape(catalog)).toEqual(shape(remote));
      expect(catalog.customerTypeId).toBe(remote.customerTypeId);
    });

    it('critère 1 : une commande créée sans réseau est appliquée une seule fois', async () => {
      d.transport.offline = true;
      await d.engine.enqueue(
        'workday.start',
        { workdayId: uuidv7(), date: DAY, offline: true },
        null,
      );
      const customerId = await orderable();
      const { number } = await queueOrder(customerId, 2);
      expect((await d.engine.sync()).ok).toBe(false);
      expect((await d.store.outbox()).every((o) => o.status === 'FAILED')).toBe(true);

      // Réseau revenu, mais la réponse se perd : le même envoi repart
      d.transport.offline = false;
      d.transport.loseNextResponse = true;
      expect((await d.engine.sync({ force: true })).ok).toBe(false);
      expect((await d.engine.sync({ force: true })).ok).toBe(true);
      expect(await raw.order.count({ where: { number } })).toBe(1);
      expect(await d.store.outbox()).toEqual([]);
      const workday = await raw.workday.findFirstOrThrow({
        where: { date: new Date(`${DAY}T00:00:00Z`), user: { code: 'V07' } },
      });
      expect(workday.isStartedOffline).toBe(true);
    });

    it('critère 2 : un quota baissé pendant la coupure met l’excédent en attente, signalé', async () => {
      const first = await raw.order.findFirstOrThrow({
        where: { orderDate: new Date(`${DAY}T00:00:00Z`), sellerUser: { code: 'V07' } },
      });
      const customerId = await orderable([first.customerId]);
      d.transport.offline = true;
      // 2 cartons déjà commandés, quota de 10 : 6 cartons tiennent dans le quota sur le téléphone
      const { op, number, built } = await queueOrder(customerId, 6);
      expect(built.expected.find((e) => e.pendingQty > 0)).toBeUndefined();
      // Le superviseur baisse le quota à 5 cartons pendant la coupure
      await raw.quota.update({
        where: { id: quotaId },
        data: { qty: 5 * thon().unit.baseQty, enteredQty: 5 },
      });
      d.transport.offline = false;
      expect((await d.engine.sync({ force: true })).ok).toBe(true);

      const kept = (await d.store.outbox()).find((o) => o.opId === op.opId)!;
      expect(kept).toMatchObject({ status: 'SYNCED', seen: false });
      expect(kept.changes).toContainEqual({
        kind: 'QUOTA_PENDING',
        productVariantId: thon().variantId,
        pendingQty: 3 * thon().unit.baseQty,
      });
      const order = await raw.order.findFirstOrThrow({
        where: { number },
        include: { orderLines: true },
      });
      expect(order.orderLines.find((l) => l.kind === 'PENDING')).toMatchObject({
        orderedQty: 3 * thon().unit.baseQty,
        pendingStatus: 'TO_PROCESS',
      });
      // La vue locale suit le serveur : ligne en attente sur la commande reçue
      const local = await d.local();
      expect(local.orders.get(order.id)!.lines.some((l) => l.kind === 'PENDING')).toBe(true);
    });
  });

  it('critère 3 : une journée complète de cash van sans réseau, puis synchronisée', async () => {
    const d = await device('C01', 'CASHVAN-EST');
    const user = await raw.user.findFirstOrThrow({
      where: { code: 'C01', company: { code: 'CASHVAN-EST' } },
    });
    const cvProducts = (
      await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', {
        token: await webLogin(t.url, 'CASHVAN-EST', 'B-SUP'),
      })
    ).body;
    // Stock connu dans le camion, quel que soit l'ordre des suites
    const truckRow = await raw.warehouse.findFirstOrThrow({
      where: { type: 'TRUCK', assignedUserId: user.id },
    });
    const seeded = cvProducts.find((x) => x.variants.some((v) => v.reference === 'BIMO-CHOC'))!;
    await raw.$transaction((tx) =>
      t.app.get(StockLedger).apply(tx, { companyId: user.companyId, userId: user.id }, [
        {
          type: 'ADJUSTMENT',
          variantId: seeded.variants.find((v) => v.reference === 'BIMO-CHOC')!.id,
          qty: 50,
          toWarehouseId: truckRow.id,
        },
      ]),
    );
    expect((await d.engine.sync()).ok).toBe(true);

    let local = await d.local();
    const truckCheck = local.truckCheck;
    const article = truckStockView(local).find((s: TruckStockDto) => s.qty >= 2);
    expect(article, 'stock dans le camion').toBeTruthy();
    const product = cvProducts.find((p) => p.id === article!.productId)!;
    const base = product.units.find((u) => u.baseQty === 1) ?? product.units[0]!;
    const customerId = todayView(local, DAY).day.customers[0]!.id;
    // Crédit autorisé, pour une vente en partie à crédit puis un encaissement de la dette
    await raw.customer.update({
      where: { id: customerId },
      data: { isCreditAllowed: true, creditLimitAmount: 10_000_000 },
    });
    expect((await d.engine.sync({ force: true })).ok).toBe(true);

    // Coupure : toute la journée se fait sur le téléphone
    d.transport.offline = true;
    const workdayId = uuidv7();
    await d.engine.enqueue('workday.start', { workdayId, date: DAY, offline: true }, null);
    await d.engine.enqueue(
      'truck.check',
      { lines: truckCheck.map((l) => ({ variantId: l.variantId, countedQty: l.inTruck })) },
      workdayId,
    );
    const visitId = uuidv7();
    // En cash van, la visite se fait sur place
    await d.engine.enqueue('visit.start', { visitId, customerId, mode: 'ON_SITE' }, workdayId);
    local = await d.local();
    const lines = [{ variantId: article!.variantId, unitId: base.id, qty: 1 }];
    const due = buildOrder(local, {
      customerTypeId: local.customers.get(customerId)!.customerType.id,
      date: DAY,
      lines,
      cashVan: true,
    }).totalAmount;
    expect(due).toBeGreaterThan(0);
    const cash = Math.floor(due / 2);
    await d.engine.enqueue(
      'sale.confirm',
      {
        orderId: uuidv7(),
        number: `C01-${d.p.series}9001`,
        visitId,
        lines,
        cashAmount: cash,
        offline: true,
      },
      workdayId,
    );
    await d.engine.enqueue(
      'payment.debt',
      { paymentId: uuidv7(), number: `C01-${d.p.series}9002`, customerId, amount: due - cash },
      workdayId,
    );
    await d.engine.enqueue('workday.close', { workdayId, offline: true }, workdayId);

    local = await d.local();
    expect(todayView(local, DAY).workday?.status).toBe('CLOSED');
    const localTruck =
      truckStockView(local).find((s) => s.variantId === article!.variantId)?.qty ?? 0;
    const localDebt = local.customers.get(customerId)!.debtAmount;
    expect((await d.engine.sync()).ok).toBe(false);

    // Retour du réseau : un cycle, tout est appliqué
    d.transport.offline = false;
    const report = await d.engine.sync({ force: true });
    expect(report, JSON.stringify(await d.store.outbox())).toMatchObject({
      ok: true,
      conflicts: 0,
    });
    expect(await d.store.outbox()).toEqual([]);
    const workday = await raw.workday.findUniqueOrThrow({ where: { id: workdayId } });
    expect(workday).toMatchObject({
      status: 'CLOSED',
      isStartedOffline: true,
      isClosedOffline: true,
    });
    const truck = await raw.warehouse.findFirstOrThrow({
      where: { type: 'TRUCK', assignedUserId: user.id },
    });
    const stock = await raw.stock.findFirstOrThrow({
      where: { warehouseId: truck.id, productVariantId: article!.variantId },
    });
    expect(stock.physicalQty).toBe(localTruck);
    const customer = await raw.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(Number(customer.debtAmount)).toBe(localDebt);
  });
});
