import type {
  CustomerDto,
  DeliveryPreviewDto,
  DriverRouteDto,
  ProductDto,
  RouteCandidateDto,
  RoutePreparationDto,
  UnloadDto,
  UnloadPreviewLine,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite ; livraison le dimanche (jour ouvré), lundi pour les reprogrammées. */
const DAY = '2027-03-06';
const DELIVERY = '2027-03-07';
const NEXT = '2027-03-08';

/** Livraison, tournées et objectifs du livreur (phase 19). */
describe('livraison (phase 19)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let phones: Phones;
  let products: ProductDto[];
  let driver: Phone;
  let driverWorkday: string;
  let routeId: string;
  const orders: Record<string, { id: string; customer: CustomerDto }> = {};

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

  /** Clients du jour du vendeur, les « Détail » d'abord. */
  async function customersOf(p: Phone) {
    const day = (await phones.today(p, DAY)).body.day;
    const list: CustomerDto[] = [];
    for (const c of day.customers)
      list.push((await call<CustomerDto>(t.url, 'GET', `/customers/${c.id}`, { token: sup })).body);
    return list.sort(
      (a, b) => Number(b.customerType.code === 'DETAIL') - Number(a.customerType.code === 'DETAIL'),
    );
  }

  async function order(p: Phone, key: string, customer: CustomerDto, lines: unknown[], n: number) {
    const visitId = await phones.startVisit(p, customer.id, 'PHONE');
    const orderId = uuidv7();
    const reply = await phones.send(p, 'order.confirm', {
      orderId,
      number: `${key.slice(0, 3)}-${p.series}19${String(n).padStart(2, '0')}`,
      visitId,
      lines,
    });
    expect(reply.status, JSON.stringify(reply)).toBe('APPLIED');
    orders[key] = { id: orderId, customer };
  }

  const myRoute = async () =>
    (await call<DriverRouteDto>(t.url, 'GET', '/me/route', { token: driver.token })).body;
  const preview = async (body: Record<string, unknown>) =>
    call<DeliveryPreviewDto>(t.url, 'POST', '/me/deliveries/preview', {
      token: driver.token,
      body,
    });
  let receipt = 0;
  const nextNumber = () => `L01-${driver.series}${String(++receipt).padStart(4, '0')}`;

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;

    // Commandes de V07 (A, B) et de V08 (C, D, E), journées clôturées → commandes figées
    const v07 = await phones.get('V07');
    const w07 = await phones.startDay(v07, DAY);
    const c07 = await customersOf(v07);
    await order(v07, 'A', c07[0]!, [line('THON-TOM', 12), line('BIMO-CHOC', 2)], 1);
    await order(v07, 'B', c07[1]!, [line('THON-TOM', 5)], 2);
    await phones.closeDay(v07, w07);
    const v08 = await phones.get('V08');
    const w08 = await phones.startDay(v08, DAY);
    const c08 = await customersOf(v08);
    await order(v08, 'C', c08[0]!, [line('THON-HUI', 2)], 1);
    await order(v08, 'D', c08[1]!, [line('BIMO-CHOC', 1)], 2);
    await order(v08, 'E', c08[2]!, [line('THON-HUI', 1)], 3);
    await phones.closeDay(v08, w08);

    // Tournée du livreur L01 lancée, préparée telle quelle et chargée
    const [group] = (
      await call<RouteCandidateDto[]>(t.url, 'GET', `/routes?date=${DELIVERY}`, { token: sup })
    ).body;
    const launched = await call<RouteCandidateDto>(t.url, 'POST', '/routes/launch', {
      token: sup,
      body: { date: DELIVERY, driverId: group!.driver!.id },
    });
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    routeId = launched.body.routeId!;
    const view = (
      await call<RoutePreparationDto>(t.url, 'GET', `/routes/${routeId}/preparation`, {
        token: sup,
      })
    ).body;
    const prepared = await call(t.url, 'POST', `/routes/${routeId}/prepare`, {
      token: sup,
      body: {
        lines: view.orders
          .flatMap((o) => o.lines)
          .map((l) => ({ lineId: l.lineId, preparedQty: l.defaultPrepared })),
      },
    });
    expect(prepared.status).toBe(200);
    expect((await call(t.url, 'POST', `/routes/${routeId}/load`, { token: sup })).status).toBe(201);

    driver = await phones.get('L01');
    driverWorkday = uuidv7();
    const started = await phones.send(driver, 'workday.start', {
      workdayId: driverWorkday,
      date: DELIVERY,
    });
    expect(started.status, JSON.stringify(started)).toBe('APPLIED');
  });
  afterAll(async () => {
    // Commandes annulées, tournées et journées closes : modules.test.ts change le mode
    await raw.order.updateMany({
      where: { id: { in: Object.values(orders).map((o) => o.id) } },
      data: { status: 'CANCELLED' },
    });
    await raw.deliveryRoute.updateMany({
      where: { company: { code: 'DISTRI-ORAN' }, deliveryDate: new Date(`${DELIVERY}T00:00:00Z`) },
      data: { status: 'CLOSED' },
    });
    await raw.workday.updateMany({
      where: {
        company: { code: 'DISTRI-ORAN' },
        date: { in: [DAY, DELIVERY].map((d) => new Date(`${d}T00:00:00Z`)) },
      },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await t.close();
  });

  describe('réception du chargement (UC-30, BR-PRE-05)', () => {
    it('le livreur reçoit son chargement : un manquant est ajusté, les commandes partent', async () => {
      const route = await myRoute();
      expect(route.loadToReceive).not.toBeNull();
      const load = await raw.load.findFirstOrThrow({
        where: { routeId },
        include: { loadLines: true },
      });
      const thon = item('THON-TOM');
      // Un carton de thon tomate manque dans le camion
      const received = await phones.send(driver, 'load.receive', {
        loadId: load.id,
        lines: load.loadLines.map((l) => ({
          variantId: l.productVariantId,
          receivedQty:
            l.productVariantId === thon.variantId ? l.loadedQty! - thon.baseQty : l.loadedQty!,
        })),
      });
      expect(received.status, JSON.stringify(received)).toBe('APPLIED');
      const after = await raw.load.findUniqueOrThrow({ where: { id: load.id } });
      expect(after).toMatchObject({ status: 'RECEIVED', hasGap: true });
      const missing = await raw.stockMovement.findFirstOrThrow({
        where: { type: 'ADJUSTMENT', sourceType: 'LOAD', sourceId: load.id },
        include: { reason: true },
      });
      expect(missing).toMatchObject({ qty: thon.baseQty, fromWarehouseId: load.truckId });
      expect(missing.reason?.label).toBe('Marchandise manquante');
      const statuses = await raw.order.findMany({
        where: { id: { in: Object.values(orders).map((o) => o.id) } },
      });
      expect(statuses.every((o) => o.status === 'OUT_FOR_DELIVERY')).toBe(true);
      const view = await myRoute();
      expect(view.loadToReceive?.id).not.toBe(load.id);
      expect(view.route).toMatchObject({ status: 'OUT_FOR_DELIVERY' });
      expect(view.deliveries).toHaveLength(5);
    });
  });

  describe('livraison (UC-32, BR-LIV-02, BR-PAY-03)', () => {
    const deliveryOf = async (key: string) =>
      (await myRoute()).deliveries.find((d) => d.orderId === orders[key]!.id)!;
    /** Lignes normales avec leur quantité livrée (par défaut, tout le préparé). */
    const normalLines = (
      d: Awaited<ReturnType<typeof deliveryOf>>,
      qty: Record<string, number> = {},
    ) =>
      d.lines
        .filter((l) => l.kind === 'NORMAL')
        .map((l) => ({ lineId: l.lineId, qty: qty[l.variantId] ?? l.preparedQty }));
    const truckMoves = (deliveryId: string) =>
      raw.stockMovement.findMany({
        where: { type: 'OUT', sourceType: 'DELIVERY', sourceId: deliveryId },
      });

    it('refuse un encaissement sous le dû sans crédit ; livraison partielle : palier perdu, bonus réduit', async () => {
      const a = await deliveryOf('A');
      const thon = item('THON-TOM');
      const lines = normalLines(a, { [thon.variantId]: 8 });
      const priced = await preview({ orderId: a.orderId, lines, added: [] });
      expect(priced.status).toBe(200);
      const bimoPrice = a.lines.find((l) => l.variantId === item('BIMO-CHOC').variantId)!.unitPrice;
      // 8 cartons : sous le palier de 10, prix de base 5 800 ; 8 × 4 = 32 triplettes offertes
      expect(priced.body.dueAmount).toBe(8 * 5800 + 2 * bimoPrice);
      expect(priced.body.minimumCash).toBe(priced.body.dueAmount);
      expect(priced.body.lines.find((l) => l.kind === 'BONUS')).toMatchObject({ qty: 32 });

      const base = { orderId: a.orderId, lines, added: [] };
      const short = await phones.send(driver, 'delivery.confirm', {
        ...base,
        deliveryId: uuidv7(),
        number: nextNumber(),
        cashAmount: priced.body.dueAmount - 1,
      });
      expect(short.status).toBe('REJECTED');

      const deliveryId = uuidv7();
      const done = await phones.send(driver, 'delivery.confirm', {
        ...base,
        deliveryId,
        number: nextNumber(),
        cashAmount: priced.body.dueAmount,
      });
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      const order = await raw.order.findUniqueOrThrow({ where: { id: a.orderId } });
      expect(order).toMatchObject({
        status: 'PARTIALLY_DELIVERED',
        totalAmount: BigInt(priced.body.dueAmount),
      });
      expect(await raw.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({
        result: 'PARTIAL',
        deliveredAmount: BigInt(priced.body.dueAmount),
      });
      const payment = await raw.payment.findFirstOrThrow({ where: { deliveryId } });
      expect(payment).toMatchObject({
        cashAmount: BigInt(priced.body.dueAmount),
        creditAmount: 0n,
      });
      const moves = await truckMoves(deliveryId);
      expect(moves.find((m) => m.productVariantId === thon.variantId)?.qty).toBe(8 * thon.baseQty);
      expect(moves.find((m) => m.productVariantId === item('THON-HUI').variantId)?.qty).toBe(32);
    });

    it('vend à un autre client les produits revenus dans le camion, avec crédit', async () => {
      const b = await deliveryOf('B');
      await raw.customer.update({
        where: { id: orders.B!.customer.id },
        data: { isCreditAllowed: true, creditLimitAmount: 1_000_000n },
      });
      const before = await raw.customer.findUniqueOrThrow({ where: { id: orders.B!.customer.id } });
      const thon = item('THON-TOM');
      // Deux des cartons refusés par le client A rejoignent la commande de B (5 → 7 cartons)
      const body = {
        orderId: b.orderId,
        lines: normalLines(b),
        added: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 2 }],
      };
      const priced = await preview(body);
      expect(priced.status).toBe(200);
      expect(priced.body.lines.find((l) => l.kind === 'NORMAL')).toMatchObject({ qty: 7 });
      expect(priced.body.minimumCash).toBe(0);
      const deliveryId = uuidv7();
      const done = await phones.send(driver, 'delivery.confirm', {
        ...body,
        deliveryId,
        number: nextNumber(),
        cashAmount: 1000,
      });
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      const after = await raw.customer.findUniqueOrThrow({ where: { id: orders.B!.customer.id } });
      expect(after.debtAmount).toBe(before.debtAmount + BigInt(priced.body.dueAmount - 1000));
      expect(
        await raw.customerDebtEntry.findFirst({
          where: { customerId: after.id, kind: 'CREDIT_SALE' },
          orderBy: { occurredAt: 'desc' },
        }),
      ).toMatchObject({ amount: BigInt(priced.body.dueAmount - 1000) });
      const order = await raw.order.findUniqueOrThrow({ where: { id: b.orderId } });
      expect(order.status).toBe('DELIVERED');
      const line = await raw.orderLine.findFirstOrThrow({
        where: { orderId: b.orderId, kind: 'NORMAL' },
      });
      expect(line).toMatchObject({ enteredQty: 7, deliveredQty: 7 * thon.baseQty });
    });

    it("refuse une vente ajoutée d'un article absent du camion", async () => {
      const d = await deliveryOf('D');
      const fraise = item('BIMO-FRA');
      const refused = await phones.send(driver, 'delivery.confirm', {
        orderId: d.orderId,
        lines: normalLines(d),
        added: [{ variantId: fraise.variantId, unitId: fraise.unitId, qty: 1 }],
        deliveryId: uuidv7(),
        number: nextNumber(),
        cashAmount: 1_000_000,
      });
      expect(refused.status).toBe('REJECTED');
      expect((await raw.order.findUniqueOrThrow({ where: { id: d.orderId } })).status).toBe(
        'OUT_FOR_DELIVERY',
      );
    });

    it("refuse une commande qui n'est pas de sa tournée et une quantité au-delà du préparé", async () => {
      const d = await deliveryOf('D');
      const tooMuch = await preview({
        orderId: d.orderId,
        lines: d.lines
          .filter((l) => l.kind === 'NORMAL')
          .map((l) => ({ lineId: l.lineId, qty: l.preparedQty + 1 })),
        added: [],
      });
      expect(tooMuch.status).toBe(422);
      const v07 = await phones.get('V07');
      expect((await call(t.url, 'GET', '/me/route', { token: v07.token })).status).toBe(403);
    });
  });

  describe('échecs, clôture et déchargement (UC-33, BR-LIV-04 à 06)', () => {
    const failureReason = async (code: string) =>
      (
        await raw.reason.findFirstOrThrow({
          where: {
            company: { code: 'DISTRI-ORAN' },
            kind: 'DELIVERY_FAILURE',
            systemCode: code as never,
          },
        })
      ).id;
    const fail = async (key: string, code: string) =>
      phones.send(driver, 'delivery.fail', {
        deliveryId: uuidv7(),
        number: nextNumber(),
        orderId: orders[key]!.id,
        reasonId: await failureReason(code),
      });

    it('client absent : la livraison est reprogrammée au jour ouvré suivant', async () => {
      const failed = await fail('C', 'CUSTOMER_ABSENT');
      expect(failed.status, JSON.stringify(failed)).toBe('APPLIED');
      const order = await raw.order.findUniqueOrThrow({ where: { id: orders.C!.id } });
      expect(order).toMatchObject({
        status: 'LOCKED',
        routeId: null,
        deliveryDate: new Date(`${NEXT}T00:00:00Z`),
      });
      expect(
        await raw.delivery.findFirst({ where: { orderId: order.id, result: 'FAILED' } }),
      ).not.toBeNull();
    });

    it('refus : échec définitif', async () => {
      expect((await fail('D', 'REFUSED')).status).toBe('APPLIED');
      expect((await raw.order.findUniqueOrThrow({ where: { id: orders.D!.id } })).status).toBe(
        'FAILED',
      );
    });

    it('à la clôture, la livraison non faite échoue « non livrée » et la tournée se termine', async () => {
      await phones.closeDay(driver, driverWorkday);
      const e = await raw.order.findUniqueOrThrow({ where: { id: orders.E!.id } });
      expect(e).toMatchObject({ status: 'LOCKED', deliveryDate: new Date(`${NEXT}T00:00:00Z`) });
      const route = await raw.deliveryRoute.findUniqueOrThrow({ where: { id: routeId } });
      expect(route.status).toBe('CLOSED');
      const [launched] = (
        await call<RouteCandidateDto[]>(t.url, 'GET', `/routes?date=${DELIVERY}`, { token: sup })
      ).body.filter((r) => r.routeId === routeId);
      expect(launched!.progress).toMatchObject({ delivered: 1, partial: 1, failed: 3, pending: 0 });
    });

    it('au déchargement : livré et offert distingués, commandes reprogrammées réservées de nouveau', async () => {
      const lines = (
        await call<UnloadPreviewLine[]>(
          t.url,
          'GET',
          `/unloads/preview?workdayId=${driverWorkday}`,
          {
            token: sup,
          },
        )
      ).body;
      const huile = lines.find((l) => l.variantId === item('THON-HUI').variantId)!;
      // Le thon à l'huile n'a été qu'offert : 32 triplettes au client A, 20 au client B (son bonus
      // recalculé sur 7 cartons est plafonné aux 20 préparées)
      expect(huile).toMatchObject({ free: 52, delivered: 0 });
      const unloaded = await call<UnloadDto>(t.url, 'POST', '/unloads', {
        token: sup,
        body: {
          workdayId: driverWorkday,
          lines: lines.map((l) => ({ variantId: l.variantId, countedQty: l.theoretical })),
        },
      });
      expect(unloaded.status, JSON.stringify(unloaded.body)).toBe(201);
      for (const key of ['C', 'E']) {
        const reserved = await raw.orderLine.findMany({
          where: { orderId: orders[key]!.id, kind: 'NORMAL' },
        });
        expect(
          reserved.every((l) => l.reservedQty > 0),
          key,
        ).toBe(true);
      }
    });
  });
});
