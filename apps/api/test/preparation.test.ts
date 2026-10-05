import type { CustomerDto, ProductDto, RouteCandidateDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite ; livraison le dimanche suivant (jour ouvré). */
const DAY = '2027-02-06';
const DELIVERY = '2027-02-07';

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
  async function order(p: Phone, key: string, lines: unknown[]) {
    const customer = await detailCustomer(p, DAY);
    const visitId = await phones.startVisit(p, customer.id, 'PHONE');
    const orderId = uuidv7();
    const reply = await phones.send(p, 'order.confirm', {
      orderId,
      number: `${key}-${p.series}1801`,
      visitId,
      lines,
    });
    expect(reply.status).toBe('APPLIED');
    orderIds[key] = orderId;
  }

  const candidates = async () =>
    (await call<RouteCandidateDto[]>(t.url, 'GET', `/routes?date=${DELIVERY}`, { token: sup }))
      .body;
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
      where: { company: { code: 'DISTRI-ORAN' }, date: new Date(`${DAY}T00:00:00Z`) },
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
});
