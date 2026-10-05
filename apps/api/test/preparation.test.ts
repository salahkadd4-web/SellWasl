import type {
  CustomerDto,
  ProductDto,
  RouteCandidateDto,
  RoutePreparationDto,
  RouteSummaryDto,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite ; livraison le dimanche suivant (jour ouvré). */
const DAY = '2027-02-06';
const DELIVERY = '2027-02-07';
/** Second samedi : P-04 désactivé et préparations simultanées. */
const DAY2 = '2027-02-13';
const DELIVERY2 = '2027-02-14';

/** Préparation des tournées (phase 18). */
describe('préparation (phase 18)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let phones: Phones;
  let products: ProductDto[];
  let v07: Phone;
  let v08: Phone;
  let v08Workday: string;
  const orderIds: Record<string, string> = {};
  let routeId: string;

  function item(variantReference: string, unitName = 'carton') {
    const product = products.find((p) => p.variants.some((v) => v.reference === variantReference))!;
    const unit = product.units.find((u) => u.name === unitName)!;
    return {
      variantId: product.variants.find((v) => v.reference === variantReference)!.id,
      unitId: unit.id,
      baseQty: unit.baseQty,
    };
  }
  const line = (ref: string, qty: number) => {
    const i = item(ref);
    return { variantId: i.variantId, unitId: i.unitId, qty };
  };

  async function detailCustomer(p: Phone, date: string) {
    const day = (await phones.today(p, date)).body.day;
    for (const c of day.customers) {
      const fiche = await call<CustomerDto>(t.url, 'GET', `/customers/${c.id}`, { token: sup });
      if (fiche.body.customerType.code === 'DETAIL') return fiche.body;
    }
    throw new Error('Aucun client Détail ce jour-là');
  }

  /** Une commande confirmée par le vendeur, sur un client Détail de son jour. */
  async function order(p: Phone, key: string, lines: unknown[], date = DAY) {
    const customer = await detailCustomer(p, date);
    const visitId = await phones.startVisit(p, customer.id, 'PHONE');
    const orderId = uuidv7();
    const reply = await phones.send(p, 'order.confirm', {
      orderId,
      number: `${key.slice(0, 3)}-${p.series}${date === DAY ? '1801' : '1802'}`,
      visitId,
      lines,
    });
    expect(reply.status).toBe('APPLIED');
    orderIds[key] = orderId;
  }

  const candidates = async (date = DELIVERY) =>
    (await call<RouteCandidateDto[]>(t.url, 'GET', `/routes?date=${date}`, { token: sup })).body;
  const preparation = async (id: string) =>
    (await call<RoutePreparationDto>(t.url, 'GET', `/routes/${id}/preparation`, { token: sup }))
      .body;
  const prepare = (id: string, lines: { lineId: string; preparedQty: number }[]) =>
    call(t.url, 'POST', `/routes/${id}/prepare`, { token: sup, body: { lines } });

  /** Change des règles P-xx le temps d'un test (nouvelle version des paramètres, supprimée ensuite). */
  async function withRules(rules: Record<string, boolean>, fn: () => Promise<void>) {
    const latest = await raw.companySettings.findFirstOrThrow({
      where: { company: { code: 'DISTRI-ORAN' } },
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
  const territory = (code: string) =>
    raw.territory.findFirstOrThrow({ where: { code, company: { code: 'DISTRI-ORAN' } } });

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;

    // V07 : commande puis journée clôturée → commande figée, livrable le lendemain
    v07 = await phones.get('V07');
    const w07 = await phones.startDay(v07, DAY);
    await order(v07, 'V07', [line('THON-TOM', 12), line('BIMO-CHOC', 1)]);
    await phones.closeDay(v07, w07);

    // V08 : quota d'un carton de thon à l'huile ; sa commande en demande deux → une ligne en attente
    v08 = await phones.get('V08');
    const seller = await raw.user.findFirstOrThrow({
      where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
    });
    const huile = item('THON-HUI');
    await raw.quota.create({
      data: {
        id: uuidv7(),
        companyId: seller.companyId,
        userId: seller.id,
        productVariantId: huile.variantId,
        date: new Date(`${DAY}T00:00:00Z`),
        qty: huile.baseQty,
        enteredQty: 1,
        enteredUnitId: huile.unitId,
      },
    });
    v08Workday = await phones.startDay(v08, DAY);
    await order(v08, 'V08', [line('THON-HUI', 2)]);
  });
  afterAll(async () => {
    // Commandes annulées et journées clôturées : modules.test.ts change le mode de l'entreprise
    await raw.order.updateMany({
      where: { id: { in: Object.values(orderIds) } },
      data: { status: 'CANCELLED' },
    });
    await raw.workday.updateMany({
      where: {
        company: { code: 'DISTRI-ORAN' },
        date: { in: [DAY, DAY2].map((d) => new Date(`${d}T00:00:00Z`)) },
      },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await t.close();
  });

  it("l'admin et le superviseur peuvent préparer sur le Web", async () => {
    const me = await call<{ permissions: string[] }>(t.url, 'GET', '/me', { token: sup });
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['preparation.launch', 'preparation.do']),
    );
  });

  describe('lancement (UC-61)', () => {
    it('regroupe les commandes figées par livreur ; une journée en cours bloque', async () => {
      const list = await candidates();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        routeId: null,
        status: 'DRAFT',
        driver: expect.objectContaining({ code: 'L01' }),
        truck: expect.objectContaining({ code: 'TRUCK-01' }),
        ordersCount: 1,
        blockers: ['WORKDAY_IN_PROGRESS'],
      });
      expect(list[0]!.territories.map((x) => x.code).sort()).toEqual(['3101', '3102']);
    });

    it('les lignes en attente non traitées bloquent, le lancement est refusé', async () => {
      await phones.closeDay(v08, v08Workday);
      const [group] = await candidates();
      expect(group).toMatchObject({ ordersCount: 2, blockers: ['PENDING_LINES'] });
      const refused = await call<{ error: { details?: { blockers?: string[] } } }>(
        t.url,
        'POST',
        '/routes/launch',
        { token: sup, body: { date: DELIVERY, driverId: group!.driver!.id } },
      );
      expect(refused.status).toBe(422);
      expect(refused.body.error.details?.blockers).toEqual(['PENDING_LINES']);
    });

    it("un secteur sans livreur forme un groupe bloqué ; changer le livreur d'un secteur", async () => {
      const ouest = await territory('3102');
      const patch = (deliveryUserId: string | null) =>
        call(t.url, 'PATCH', `/territories/${ouest.id}`, { token: sup, body: { deliveryUserId } });
      expect((await patch(null)).status).toBe(200);
      const split = await candidates();
      expect(split).toHaveLength(2);
      expect(split.find((g) => g.driver === null)).toMatchObject({
        blockers: expect.arrayContaining(['NO_DRIVER']),
        ordersCount: 1,
      });
      expect((await patch(ouest.deliveryUserId)).status).toBe(200);
      expect(await candidates()).toHaveLength(1);
    });

    it('un livreur sans camion bloque', async () => {
      const truck = await raw.warehouse.findFirstOrThrow({
        where: { company: { code: 'DISTRI-ORAN' }, code: 'TRUCK-01' },
      });
      await raw.warehouse.update({ where: { id: truck.id }, data: { isActive: false } });
      try {
        expect((await candidates())[0]!.blockers).toContain('NO_TRUCK');
      } finally {
        await raw.warehouse.update({ where: { id: truck.id }, data: { isActive: true } });
      }
    });

    it('lance la préparation : tournée créée, commandes en préparation', async () => {
      const pending = await raw.orderLine.findFirstOrThrow({
        where: { orderId: orderIds.V08, kind: 'PENDING' },
      });
      const decided = await call(t.url, 'POST', '/pending-lines/decide', {
        token: sup,
        body: { lineIds: [pending.id], decision: 'REFUSE' },
      });
      expect(decided.status).toBe(200);
      const [group] = await candidates();
      expect(group!.blockers).toEqual([]);
      const launched = await call<RouteCandidateDto>(t.url, 'POST', '/routes/launch', {
        token: sup,
        body: { date: DELIVERY, driverId: group!.driver!.id },
      });
      expect(launched.status).toBe(201);
      expect(launched.body).toMatchObject({ status: 'PREPARING', ordersCount: 2 });
      routeId = launched.body.routeId!;
      const orders = await raw.order.findMany({ where: { id: { in: Object.values(orderIds) } } });
      expect(
        orders.every((o) => o.status === 'PREPARING' && o.routeId === launched.body.routeId),
      ).toBe(true);
      const after = await candidates();
      expect(after).toEqual([expect.objectContaining({ routeId: launched.body.routeId })]);
    });

    it('refuse le pré-vendeur', async () => {
      expect(
        (await call(t.url, 'GET', `/routes?date=${DELIVERY}`, { token: v07.token })).status,
      ).toBe(403);
    });
  });

  describe('préparation (UC-41)', () => {
    const lineOf = (view: RoutePreparationDto, key: string, ref: string, kind = 'NORMAL') =>
      view.orders
        .find((o) => o.orderId === orderIds[key])!
        .lines.find((l) => l.kind === kind && l.variantId === item(ref).variantId)!;

    it('montre la liste de chargement et le détail par commande', async () => {
      const view = await preparation(routeId);
      expect(view.route).toMatchObject({ id: routeId, status: 'PREPARING', ordersCount: 2 });
      expect(view.orders).toHaveLength(2);
      expect(lineOf(view, 'V07', 'THON-TOM')).toMatchObject({
        enteredQty: 12,
        defaultPrepared: 12,
      });
      // 12 cartons de thon tomate : 48 triplettes de thon à l'huile offertes
      expect(lineOf(view, 'V07', 'THON-HUI', 'BONUS')).toMatchObject({
        enteredQty: 48,
        defaultPrepared: 48,
      });
      expect(view.items.find((i) => i.variantId === item('THON-TOM').variantId)).toMatchObject({
        orderedBase: 12 * item('THON-TOM').baseQty,
      });
      const toPrepare = await call<RouteSummaryDto[]>(t.url, 'GET', '/routes/preparing', {
        token: sup,
      });
      expect(toPrepare.body.map((r) => r.id)).toContain(routeId);
    });

    it('refuse une ligne oubliée ou préparée au-delà du commandé', async () => {
      const view = await preparation(routeId);
      const all = view.orders.flatMap((o) => o.lines);
      const missing = await prepare(
        routeId,
        all.slice(1).map((l) => ({ lineId: l.lineId, preparedQty: l.defaultPrepared })),
      );
      expect(missing.status).toBe(422);
      const tooMuch = await prepare(
        routeId,
        all.map((l) => ({ lineId: l.lineId, preparedQty: l.enteredQty + 1 })),
      );
      expect(tooMuch.status).toBe(422);
    });

    it('une rupture réduit la ligne, fait perdre le palier, plafonne le bonus et libère la réservation', async () => {
      const view = await preparation(routeId);
      const thon = lineOf(view, 'V07', 'THON-TOM');
      const bonus = lineOf(view, 'V07', 'THON-HUI', 'BONUS');
      const prepared: Record<string, number> = { [thon.lineId]: 8, [bonus.lineId]: 20 };
      const done = await prepare(
        routeId,
        view.orders
          .flatMap((o) => o.lines)
          .map((l) => ({ lineId: l.lineId, preparedQty: prepared[l.lineId] ?? l.defaultPrepared })),
      );
      expect(done.status).toBe(200);

      const lines = await raw.orderLine.findMany({ where: { orderId: orderIds.V07 } });
      // 8 cartons : sous le palier de 10, le prix de base de 5 800 revient (P-04)
      expect(lines.find((l) => l.id === thon.lineId)).toMatchObject({
        unitPrice: 5800n,
        preparedQty: 8 * thon.unitBaseQty,
        reservedQty: 8 * thon.unitBaseQty,
        isStockout: true,
      });
      // 8 cartons donneraient 32 triplettes offertes : seules 20 ont été préparées
      expect(lines.find((l) => l.id === bonus.lineId)).toMatchObject({
        preparedQty: 20,
        reservedQty: 20,
      });
      const bimo = lines.find((l) => l.productVariantId === item('BIMO-CHOC').variantId)!;
      const v07order = await raw.order.findUniqueOrThrow({ where: { id: orderIds.V07 } });
      expect(v07order).toMatchObject({
        status: 'READY',
        totalAmount: 8n * 5800n + bimo.unitPrice,
      });
      const released = await raw.stockMovement.findMany({
        where: { type: 'RELEASE', sourceType: 'ORDER', sourceId: orderIds.V07 },
      });
      expect(released.map((m) => m.qty).sort((a, b) => a - b)).toEqual([28, 4 * thon.unitBaseQty]);
      const route = await raw.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
      expect(route.status).toBe('READY');
    });

    it('une tournée déjà préparée ne se prépare pas deux fois', async () => {
      const view = await preparation(routeId);
      const again = await prepare(
        routeId,
        view.orders.flatMap((o) => o.lines).map((l) => ({ lineId: l.lineId, preparedQty: 0 })),
      );
      expect(again.status).toBe(409);
    });

    describe('P-04 désactivé, réservation complétée, préparations simultanées', () => {
      let route2: string;
      beforeAll(async () => {
        const w = await phones.startDay(v07, DAY2);
        await order(v07, 'V07-2', [line('THON-TOM', 12)], DAY2);
        await phones.closeDay(v07, w);
        const [group] = await candidates(DELIVERY2);
        const launched = await call<RouteCandidateDto>(t.url, 'POST', '/routes/launch', {
          token: sup,
          body: { date: DELIVERY2, driverId: group!.driver!.id },
        });
        expect(launched.status).toBe(201);
        route2 = launched.body.routeId!;
      });

      it('garde les prix, complète la réservation, une seule préparation passe', async () => {
        // Deux cartons de la ligne n'avaient pas été réservés à la confirmation (rupture d'alors)
        const thon = item('THON-TOM');
        const thonLine = await raw.orderLine.findFirstOrThrow({
          where: { orderId: orderIds['V07-2'], kind: 'NORMAL' },
        });
        const depot = await raw.warehouse.findFirstOrThrow({
          where: { company: { code: 'DISTRI-ORAN' }, type: 'DEPOT', code: 'DEPOT' },
        });
        await raw.orderLine.update({
          where: { id: thonLine.id },
          data: { reservedQty: { decrement: 2 * thon.baseQty } },
        });
        await raw.stock.update({
          where: {
            companyId_warehouseId_productVariantId: {
              companyId: depot.companyId,
              warehouseId: depot.id,
              productVariantId: thon.variantId,
            },
          },
          data: { reservedQty: { decrement: 2 * thon.baseQty } },
        });
        const view = await preparation(route2);
        expect(view.orders[0]!.lines.find((l) => l.lineId === thonLine.id)!.defaultPrepared).toBe(
          10,
        );
        const body = view.orders
          .flatMap((o) => o.lines)
          .map((l) => ({ lineId: l.lineId, preparedQty: l.enteredQty }));
        await withRules({ P04_recalculateOnDecrease: false }, async () => {
          const results = await Promise.all([prepare(route2, body), prepare(route2, body)]);
          expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        });
        const after = await raw.orderLine.findUniqueOrThrow({ where: { id: thonLine.id } });
        expect(after).toMatchObject({ unitPrice: 5600n, reservedQty: 12 * thon.baseQty });
        const reserved = await raw.stockMovement.findMany({
          where: { type: 'RESERVATION', sourceType: 'ORDER', sourceId: orderIds['V07-2'] },
        });
        expect(reserved.map((m) => m.qty)).toContain(2 * thon.baseQty);
      });
    });
  });
});
