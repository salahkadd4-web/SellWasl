import type {
  CommercialReportDto,
  DashboardDto,
  DeliveryReportDto,
  LostSalesReportDto,
  PresalesReportDto,
  ProductDto,
  SupervisorMapDto,
  TodayRowDto,
  UserSheetDto,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite. */
const DAY = '2027-07-03';

/** Dashboard, suivi du jour, carte, fiches et rapports (phase 21). */
describe('rapports (phase 21)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let phones: Phones;
  let v07: Phone;
  let v07Id: string;
  let orderId: string;
  let orderTotal: number;
  let dayCustomers: string[];
  const q = `from=${DAY}&to=${DAY}`;
  const get = <T>(path: string, token = sup) => call<T>(t.url, 'GET', path, { token });

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    const products = (await get<ProductDto[]>('/products?status=ACTIVE')).body;
    const thon = products.find((p) => p.variants.some((v) => v.reference === 'THON-TOM'))!;
    const carton = thon.units.find((u) => u.name === 'carton')!;
    v07 = await phones.get('V07');
    v07Id = (
      await raw.user.findFirstOrThrow({ where: { code: 'V07', company: { code: 'DISTRI-ORAN' } } })
    ).id;
    const workdayId = await phones.startDay(v07, DAY);
    dayCustomers = (await phones.today(v07, DAY)).body.day.customers.map((c) => c.id);
    expect(dayCustomers.length).toBeGreaterThanOrEqual(3);

    // Une visite avec commande, une sans ; les autres clients du jour sont manqués à la clôture
    const visitId = await phones.startVisit(v07, dayCustomers[0]!, 'PHONE');
    orderId = uuidv7();
    const ordered = await phones.send(v07, 'order.confirm', {
      orderId,
      number: `RP-${v07.series}2101`,
      visitId,
      lines: [
        {
          variantId: thon.variants.find((v) => v.reference === 'THON-TOM')!.id,
          unitId: carton.id,
          qty: 3,
        },
      ],
    });
    expect(ordered.status, JSON.stringify(ordered)).toBe('APPLIED');
    orderTotal = Number(
      (await raw.order.findUniqueOrThrow({ where: { id: orderId } })).totalAmount,
    );
    const second = await phones.startVisit(v07, dayCustomers[1]!, 'PHONE');
    const reason = await raw.reason.findFirstOrThrow({
      where: { company: { code: 'DISTRI-ORAN' }, kind: 'NO_ORDER', isActive: true },
    });
    const closed = await phones.send(v07, 'visit.close_no_order', {
      visitId: second,
      reasonId: reason.id,
    });
    expect(closed.status, JSON.stringify(closed)).toBe('APPLIED');
    await phones.closeDay(v07, workdayId);
  });

  afterAll(async () => {
    await raw.order.updateMany({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    await t.close();
  });

  it('dashboard : CA, commandes, visites, clients non visités, conversion', async () => {
    const reply = await get<DashboardDto>(`/reports/dashboard?${q}`);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body).toMatchObject({
      from: DAY,
      to: DAY,
      revenue: orderTotal,
      orders: 1,
      visits: { planned: dayCustomers.length, done: 2 },
      notVisited: dayCustomers.length - 2,
      conversion: { rate: 50, volume: 2, insufficient: false },
    });
    expect(reply.body.activeSellers).toBeGreaterThanOrEqual(1);
    // Module d'analyse des retours inactif : pas de bloc retours
    expect(reply.body.returns).toBeUndefined();
  });

  it('période invalide ou trop longue : 400 ; un livreur ne voit pas les rapports', async () => {
    expect((await get(`/reports/dashboard?from=${DAY}&to=2027-07-01`)).status).toBe(400);
    expect((await get('/reports/dashboard?from=2026-01-01&to=2027-07-03')).status).toBe(400);
    const driver = await phones.get('L01');
    expect((await get(`/reports/dashboard?${q}`, driver.token)).status).toBe(403);
  });

  it('tableau du jour : une ligne par utilisateur de terrain', async () => {
    const reply = await get<TodayRowDto[]>('/reports/today');
    expect(reply.status).toBe(200);
    const codes = reply.body.map((r) => r.user.code);
    expect(codes).toEqual(expect.arrayContaining(['V07', 'V08', 'L01']));
    expect(codes).not.toContain('A-SUP');
    const row = reply.body.find((r) => r.user.code === 'V07')!;
    expect(row).toMatchObject({ pendingOps: expect.any(Number), online: expect.any(Boolean) });
  });

  it('carte : clients du jour visités ou non, parties du jour', async () => {
    const reply = await get<SupervisorMapDto>(`/reports/map?date=${DAY}`);
    expect(reply.status).toBe(200);
    expect(reply.body.parts.length).toBeGreaterThanOrEqual(1);
    const mine = reply.body.customers.filter((c) => c.userId === v07Id);
    expect(mine.find((c) => c.id === dayCustomers[0])?.visited).toBe(true);
    expect(mine.find((c) => c.id === dayCustomers[2])?.visited).toBe(false);
  });

  it("fiche d'un vendeur en lecture seule", async () => {
    const reply = await get<UserSheetDto>(`/reports/users/${v07Id}?${q}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      user: { code: 'V07' },
      workdays: 1,
      visits: 2,
      orders: 1,
      revenue: orderTotal,
      conversion: { rate: 50 },
    });
  });

  it('rapports commercial, prévente, livraison et ventes perdues', async () => {
    const commercial = await get<CommercialReportDto>(`/reports/commercial?${q}`);
    expect(commercial.status).toBe(200);
    expect(commercial.body.byDay).toEqual([{ date: DAY, orders: 1, revenue: orderTotal }]);
    expect(commercial.body.byCustomer[0]).toMatchObject({ key: dayCustomers[0], orders: 1 });
    expect(commercial.body.byProduct[0]?.revenue).toBe(orderTotal);

    const presales = await get<PresalesReportDto>(`/reports/presales?${q}`);
    expect(presales.body.bySeller.find((r) => r.key === v07Id)).toMatchObject({
      visits: 2,
      orders: 1,
      revenue: orderTotal,
      conversion: { rate: 50 },
    });
    expect(presales.body.byTerritory.length).toBeGreaterThanOrEqual(1);

    const delivery = await get<DeliveryReportDto>(`/reports/delivery?${q}`);
    expect(delivery.status).toBe(200);
    expect(delivery.body.byDriver).toEqual([]);
    const lost = await get<LostSalesReportDto>(`/reports/lost-sales?${q}`);
    expect(lost.status).toBe(200);

    // Filtre par vendeur : V08 n'a rien fait ce jour-là
    const v08 = await raw.user.findFirstOrThrow({
      where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
    });
    const filtered = await get<CommercialReportDto>(`/reports/commercial?${q}&userId=${v08.id}`);
    expect(filtered.body.byDay).toEqual([]);
  });
});
