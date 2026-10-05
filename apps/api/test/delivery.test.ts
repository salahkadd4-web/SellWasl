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
      expect(view).toMatchObject({ loadToReceive: null, route: { status: 'OUT_FOR_DELIVERY' } });
      expect(view.deliveries).toHaveLength(5);
    });
  });
});
