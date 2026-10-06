import { priceCart } from '@sellwasl/business-rules';
import type {
  CustomerDto,
  OfflineKind,
  PlanningDay,
  ProductDto,
  PulledRow,
  SyncPullResponse,
  TodayResponse,
  TruckStockDto,
  VisitCatalog,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { receptionChanges } from '../src/field/order.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite. */
const DAY = '2027-06-05';
/** Samedi réservé aux changements à la réception. */
const WORK_DAY = '2027-06-19';

/** Réception différentielle du téléphone (phase 23). */
describe('synchronisation hors connexion (phase 23)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let supA: string;
  let supB: string;
  let phones: Phones;
  let seller: Phone;

  const pull = (p: Phone, query: Record<string, string>) =>
    call<SyncPullResponse>(
      t.url,
      'GET',
      `/sync/pull?${new URLSearchParams({ date: DAY, ...query }).toString()}`,
      { token: p.token },
    );

  /** Réception complète, page par page, comme le téléphone. */
  async function pullAll(p: Phone, cursor = '0', scope?: string) {
    const rows: PulledRow[] = [];
    const replace = new Set<OfflineKind>();
    let page: string | null = null;
    let last: SyncPullResponse;
    do {
      const reply = await pull(p, {
        cursor,
        ...(scope ? { scope } : {}),
        ...(page ? { page } : {}),
      });
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      last = reply.body;
      rows.push(...last.rows);
      last.replace.forEach((k) => replace.add(k));
      page = last.page;
    } while (last.hasMore);
    return { rows, replace, cursor: last.cursor, scope: last.scope, last };
  }

  const kindsOf = (rows: PulledRow[]) => new Set(rows.map((r) => r.kind));

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': supA, 'CASHVAN-EST': supB });
    seller = await phones.get('V07');
  });
  afterAll(() => t.close());

  describe('curseur fiable (change_xid)', () => {
    it('enregistre la transaction de chaque écriture', async () => {
      const [row] = await raw.$queryRaw<{ xid: bigint }[]>`
        UPDATE reason SET label = label WHERE id = (SELECT id FROM reason LIMIT 1)
        RETURNING change_xid AS xid`;
      const [snap] = await raw.$queryRaw<{ xmin: bigint }[]>`
        SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS xmin`;
      expect(row!.xid).toBeGreaterThan(0n);
      expect(snap!.xmin).toBeGreaterThan(row!.xid);
    });
  });

  describe('réception (GET /sync/pull)', () => {
    it('pré-vendeur : réception complète de son périmètre', async () => {
      const all = await pullAll(seller);
      const kinds = kindsOf(all.rows);
      for (const k of [
        'settings',
        'reason',
        'product',
        'pricing',
        'territory',
        'planningDay',
        'customer',
      ] as const)
        expect(kinds.has(k), k).toBe(true);
      expect(kinds.has('driverDay')).toBe(false);
      expect(kinds.has('truckStock')).toBe(false);
      // Réception complète : toutes les sortes reçues sont remplacées
      for (const k of kinds) expect(all.replace.has(k), k).toBe(true);
      // Clients de son secteur seulement
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'V07', company: { code: 'DISTRI-ORAN' } },
      });
      const sectors = (await raw.territory.findMany({ where: { sellerUserId: user.id } })).map(
        (s) => s.id,
      );
      const customers = all.rows.filter((r) => r.kind === 'customer');
      expect(customers.length).toBeGreaterThan(0);
      for (const c of customers) expect(sectors).toContain((c.data as CustomerDto).territory?.id);
      // Planning du jour et du lendemain
      expect(
        all.rows.filter((r) => r.kind === 'planningDay').map((r) => (r.data as PlanningDay).date),
      ).toEqual([DAY, '2027-06-06']);
      expect(all.scope).toMatch(/^PRE_VENDEUR:t=/);
    });

    it('sans changement, la lecture suivante est vide', async () => {
      const first = await pullAll(seller);
      const next = await pullAll(seller, first.cursor, first.scope);
      // Paramètres : une ligne calculée, renvoyée à chaque fois
      expect(next.rows.filter((r) => r.kind !== 'settings')).toEqual([]);
      expect([...next.replace]).toEqual(['settings']);
    });

    it('renvoie seulement le client modifié, puis le supprime quand il sort du secteur', async () => {
      const first = await pullAll(seller);
      const customer = first.rows.find((r) => r.kind === 'customer')!;
      const patched = await call(t.url, 'PATCH', `/customers/${customer.id}`, {
        token: supA,
        body: { phone: '0550 11 22 33' },
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const next = await pullAll(seller, first.cursor, first.scope);
      const changed = next.rows.filter((r) => r.kind === 'customer');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({
        id: customer.id,
        deleted: false,
        data: { phone: '0550 11 22 33' },
      });
      expect(next.replace.has('customer')).toBe(false);

      // Hors du secteur : il part supprimé
      const before = await raw.customer.findUniqueOrThrow({ where: { id: customer.id } });
      const other = await raw.territory.findFirstOrThrow({
        where: {
          companyId: before.companyId,
          id: { not: before.territoryId! },
          sellerUserId: { not: null },
        },
      });
      await raw.customer.update({ where: { id: customer.id }, data: { territoryId: other.id } });
      try {
        const gone = await pullAll(seller, next.cursor, next.scope);
        expect(gone.rows.filter((r) => r.kind === 'customer')).toEqual([
          { kind: 'customer', id: customer.id, data: null, deleted: true },
        ]);
      } finally {
        await raw.customer.update({
          where: { id: customer.id },
          data: { territoryId: before.territoryId },
        });
      }
    });

    it('un prix modifié fait renvoyer toute la grille', async () => {
      const first = await pullAll(seller);
      const price = await raw.price.findFirstOrThrow({
        where: { company: { code: 'DISTRI-ORAN' }, deletedAt: null },
      });
      await raw.price.update({ where: { id: price.id }, data: { price: price.price } });
      const next = await pullAll(seller, first.cursor, first.scope);
      expect(next.replace.has('pricing')).toBe(true);
      expect(next.rows.filter((r) => r.kind === 'pricing').length).toBe(
        first.rows.filter((r) => r.kind === 'pricing').length,
      );
    });

    it('une écriture validée après la lecture arrive à la lecture suivante (transaction lente)', async () => {
      const first = await pullAll(seller);
      const customer = first.rows.find((r) => r.kind === 'customer')!;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let written!: () => void;
      const wrote = new Promise<void>((resolve) => (written = resolve));
      const slow = raw.$transaction(
        async (tx) => {
          await tx.customer.update({ where: { id: customer.id }, data: { address: 'Rue lente' } });
          written();
          await gate;
        },
        { timeout: 20_000 },
      );
      await wrote;
      // Une écriture plus récente est validée avant la lecture : un curseur « plus grande
      // transaction vue » sauterait la transaction lente
      await raw.$executeRaw`UPDATE reason SET label = label WHERE id = (SELECT id FROM reason LIMIT 1)`;
      // Lecture pendant que la transaction est ouverte : le client n'est pas encore visible
      const during = await pullAll(seller, first.cursor, first.scope);
      expect(during.rows.some((r) => r.kind === 'customer' && r.id === customer.id)).toBe(false);
      release();
      await slow;
      const after = await pullAll(seller, during.cursor, during.scope);
      expect(after.rows.find((r) => r.kind === 'customer' && r.id === customer.id)).toMatchObject({
        data: { address: 'Rue lente' },
      });
    });

    it('découpe la réception en pages, chaque ligne une seule fois', async () => {
      const whole = await pullAll(seller);
      process.env.SYNC_PULL_PAGE_SIZE = '5';
      try {
        const first = await pull(seller, { cursor: '0' });
        expect(first.body.hasMore).toBe(true);
        expect(first.body.rows).toHaveLength(5);
        expect(first.body.cursor).toBe('0');
        const paged = await pullAll(seller);
        const key = (r: PulledRow) => `${r.kind}:${r.id}`;
        expect(paged.rows.map(key).sort()).toEqual(whole.rows.map(key).sort());
        expect(new Set(paged.rows.map(key)).size).toBe(paged.rows.length);
        expect(BigInt(paged.cursor)).toBeGreaterThan(0n);
      } finally {
        delete process.env.SYNC_PULL_PAGE_SIZE;
      }
    });

    it('un périmètre différent demande de tout relire (reset)', async () => {
      const reply = await pull(seller, { cursor: '42', scope: 'PRE_VENDEUR:t=autre:w=' });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ reset: true, rows: [], cursor: '0' });
    });

    it('cash van : stock du camion et pointage ; livreur : sa tournée', async () => {
      const cashvan = await pullAll(await phones.get('C01', 'CASHVAN-EST'));
      expect(kindsOf(cashvan.rows).has('truckStock')).toBe(true);
      expect(kindsOf(cashvan.rows).has('truckCheck')).toBe(true);
      expect(kindsOf(cashvan.rows).has('depotStock')).toBe(false);
      const driver = await pullAll(await phones.get('L01'));
      const kinds = kindsOf(driver.rows);
      expect(kinds.has('driverDay')).toBe(true);
      expect(kinds.has('quota')).toBe(false);
      expect(kinds.has('planningDay')).toBe(false);
      expect(driver.scope).toMatch(/^LIVREUR:/);
    });

    it('refuse le Web et le magasinier', async () => {
      const web = await call(t.url, 'GET', `/sync/pull?date=${DAY}`, { token: supA });
      expect(web.status).toBe(403);
      const storekeeper = await pull(await phones.get('M01'), {});
      expect(storekeeper.status).toBe(403);
      expect(storekeeper.body.error?.code).toBe('OFFLINE_NOT_AVAILABLE');
    });
  });

  describe('changements à la réception (BR-SYN-05)', () => {
    let products: ProductDto[];
    const item = (reference: string, unitName: string) => {
      const product = products.find((p) => p.variants.some((v) => v.reference === reference))!;
      const unit = product.units.find((u) => u.name === unitName)!;
      return {
        variantId: product.variants.find((v) => v.reference === reference)!.id,
        unitId: unit.id,
        baseQty: unit.baseQty,
      };
    };

    afterAll(async () => {
      // Commandes de test annulées, journées closes (autres suites, modes de l'entreprise)
      await raw.order.updateMany({
        where: { orderDate: new Date(`${WORK_DAY}T00:00:00Z`), status: 'CONFIRMED' },
        data: { status: 'CANCELLED' },
      });
      await raw.workday.updateMany({
        where: { date: new Date(`${WORK_DAY}T00:00:00Z`), status: 'IN_PROGRESS' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    it('compare le découpage du téléphone et celui du serveur (fonction pure)', () => {
      const line = {
        productId: 'p',
        variantId: 'v',
        unitId: 'u',
        unitPrice: 100,
        tierMinQty: null,
        bonusRuleId: null,
        customerTypeId: 't',
      };
      const lines = [
        { ...line, kind: 'NORMAL' as const, qty: 5, baseQty: 100 },
        { ...line, kind: 'PENDING' as const, qty: 3, baseQty: 60 },
      ];
      expect(receptionChanges(undefined, lines, [])).toEqual([]);
      expect(
        receptionChanges([{ variantId: 'v', pendingQty: 60, stockoutQty: 0 }], lines, []),
      ).toEqual([]);
      expect(
        receptionChanges([], lines, [{ variantId: 'v', reservedQty: 40, orderedQty: 100 }]),
      ).toEqual([
        { kind: 'QUOTA_PENDING', productVariantId: 'v', pendingQty: 60 },
        { kind: 'STOCKOUT', productVariantId: 'v', orderedQty: 100, reservedQty: 40 },
      ]);
    });

    it('quota baissé pendant la coupure : excédent en attente, signalé, appliqué une fois', async () => {
      products = (
        await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supA })
      ).body;
      const p = await phones.get('V08');
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
      });
      const thon = item('THON-TOM', 'carton');
      const quota = await raw.quota.create({
        data: {
          id: uuidv7(),
          companyId: user.companyId,
          userId: user.id,
          productVariantId: thon.variantId,
          date: new Date(`${WORK_DAY}T00:00:00Z`),
          qty: 10 * thon.baseQty,
          enteredQty: 10,
          enteredUnitId: thon.unitId,
        },
      });
      await phones.startDay(p, WORK_DAY);
      const day = (await phones.today(p, WORK_DAY)).body as TodayResponse;
      const customer = day.day.customers[0]!;
      const visitId = await phones.startVisit(p, customer.id, 'PHONE');
      // Le téléphone a calculé 8 cartons dans le quota ; le superviseur le baisse à 5 avant l'envoi
      await raw.quota.update({
        where: { id: quota.id },
        data: { qty: 5 * thon.baseQty, enteredQty: 5 },
      });
      const op = phones.op(p, 'order.confirm', {
        orderId: uuidv7(),
        number: `V08-${p.series}7001`,
        visitId,
        lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 8 }],
        expected: [],
      });
      const first = (await phones.push(p, [op])).body.results[0]!;
      expect(first.status, JSON.stringify(first)).toBe('APPLIED_WITH_CHANGES');
      expect(first.changes).toContainEqual({
        kind: 'QUOTA_PENDING',
        productVariantId: thon.variantId,
        pendingQty: 3 * thon.baseQty,
      });
      // Renvoyée après une coupure : même résultat, une seule commande
      const again = (await phones.push(p, [op])).body.results[0]!;
      expect(again).toEqual(first);
      const orders = await raw.order.findMany({
        where: { number: `V08-${p.series}7001` },
        include: { orderLines: true },
      });
      expect(orders).toHaveLength(1);
      expect(orders[0]!.orderLines.find((l) => l.kind === 'PENDING')).toMatchObject({
        orderedQty: 3 * thon.baseQty,
        pendingStatus: 'TO_PROCESS',
      });
      const logged = await raw.syncOperation.findFirstOrThrow({ where: { opId: op.opId } });
      expect(logged.status).toBe('APPLIED_WITH_CHANGES');
    });

    describe('vente cash van reçue hors connexion (spec §3.4)', () => {
      let seller: Phone;
      let truckId: string;
      let customers: { id: string }[];
      let n = 0;

      /** Vente d'un article, payée comptant au prix calculé par le téléphone. */
      async function sell(
        customerId: string,
        ref: string,
        unitName: string,
        qty: number,
        offline: boolean,
        visit?: string,
      ) {
        const visitId = visit ?? (await phones.startVisit(seller, customerId, 'ON_SITE'));
        const catalog = (
          await call<VisitCatalog>(
            t.url,
            'GET',
            `/me/visit-catalog?customerId=${customerId}&date=${WORK_DAY}`,
            { token: seller.token },
          )
        ).body;
        const a = item(ref, unitName);
        const lines = [{ variantId: a.variantId, unitId: a.unitId, qty }];
        const due = priceCart(catalog.catalog, lines, {
          customerTypeId: catalog.customerTypeId,
          date: WORK_DAY,
        }).total;
        const result = await phones.send(seller, 'sale.confirm', {
          orderId: uuidv7(),
          number: `C02-${seller.series}70${String(++n).padStart(2, '0')}`,
          visitId,
          lines,
          cashAmount: due,
          ...(offline ? { offline: true } : {}),
        });
        return Object.assign(result, { visitId });
      }

      /** Un article du camion d'au moins `min` unités, vendu à l'unité de base. */
      async function truckArticle(min: number) {
        const stock = (
          await call<TruckStockDto[]>(t.url, 'GET', '/me/truck-stock', { token: seller.token })
        ).body;
        const article = stock.find((s) => s.qty >= min && s.units.some((u) => u.baseQty === 1))!;
        const product = products.find((pr) => pr.id === article.productId)!;
        return {
          article,
          ref: product.variants.find((v) => v.id === article.variantId)!.reference,
          base: product.units.find((u) => u.baseQty === 1)!,
        };
      }

      beforeAll(async () => {
        seller = await phones.get('C02', 'CASHVAN-EST');
        const user = await raw.user.findFirstOrThrow({
          where: { code: 'C02', company: { code: 'CASHVAN-EST' } },
        });
        truckId = (
          await raw.warehouse.findFirstOrThrow({
            where: { type: 'TRUCK', assignedUserId: user.id },
          })
        ).id;
        // Chargement laissé par une autre suite : pointé, pour pouvoir vendre
        await raw.load.updateMany({
          where: { userId: user.id, status: 'LOADED' },
          data: { status: 'RECEIVED' },
        });
        products = (
          await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: supB })
        ).body;
        await phones.startDay(seller, WORK_DAY);
        customers = ((await phones.today(seller, WORK_DAY)).body as TodayResponse).day.customers;
        expect(customers.length).toBeGreaterThan(2);
      });

      it('au-delà du quota : refusée en ligne, acceptée et signalée hors connexion', async () => {
        const user = await raw.user.findFirstOrThrow({
          where: { code: 'C02', company: { code: 'CASHVAN-EST' } },
        });
        const { article, ref, base } = await truckArticle(4);
        await raw.quota.create({
          data: {
            id: uuidv7(),
            companyId: user.companyId,
            userId: user.id,
            productVariantId: article.variantId,
            date: new Date(`${WORK_DAY}T00:00:00Z`),
            qty: 1,
            enteredQty: 1,
            enteredUnitId: base.id,
          },
        });
        const online = await sell(customers[0]!.id, ref, base.name, 2, false);
        expect(online.status).toBe('REJECTED');
        // Même visite : la vente refusée l'a laissée en cours
        const offline = await sell(customers[0]!.id, ref, base.name, 2, true, online.visitId);
        expect(offline.status, JSON.stringify(offline)).toBe('APPLIED_WITH_CHANGES');
        expect(offline.changes).toEqual([
          { kind: 'QUOTA_EXCEEDED', productVariantId: article.variantId, exceededQty: 1 },
        ]);
      });

      it('au-delà du stock du camion : stock à zéro, manque enregistré comme écart', async () => {
        const { article, ref, base } = await truckArticle(1);
        const result = await sell(customers[2]!.id, ref, base.name, article.qty + 3, true);
        expect(result.status, JSON.stringify(result)).toBe('APPLIED_WITH_CHANGES');
        expect(result.changes).toContainEqual({
          kind: 'TRUCK_STOCK_SHORT',
          productVariantId: article.variantId,
          shortQty: 3,
        });
        const row = await raw.stock.findFirstOrThrow({
          where: { warehouseId: truckId, productVariantId: article.variantId },
        });
        expect(row.physicalQty).toBe(0);
        const gap = await raw.discrepancy.findFirstOrThrow({
          where: { productVariantId: article.variantId, cause: { contains: 'hors connexion' } },
          orderBy: { createdAt: 'desc' },
        });
        expect(gap).toMatchObject({ kind: 'STOCK', qty: -3 });
        expect(Number(gap.amount)).toBeLessThanOrEqual(0);
      });

      it('journée démarrée et clôturée hors connexion : signalées', async () => {
        const p = await phones.get('C01', 'CASHVAN-EST');
        const workdayId = uuidv7();
        expect(
          await phones.send(p, 'workday.start', { workdayId, date: WORK_DAY, offline: true }),
        ).toMatchObject({ status: 'APPLIED' });
        expect(await phones.send(p, 'workday.close', { workdayId, offline: true })).toMatchObject({
          status: 'APPLIED',
        });
        const w = await raw.workday.findUniqueOrThrow({ where: { id: workdayId } });
        expect(w).toMatchObject({
          isStartedOffline: true,
          isClosedOffline: true,
          status: 'CLOSED',
        });
      });
    });
  });
});
