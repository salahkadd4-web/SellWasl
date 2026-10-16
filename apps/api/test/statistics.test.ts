import type {
  CommercialReportDto,
  ProductDto,
  ReturnsTrendDto,
  SalesTrendDto,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { ModulesService } from '../src/modules/modules.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

/** Samedi réservé à cette suite, loin des dates des autres suites (fenêtres de 90 jours). */
const DAY = '2033-09-03';
/** 90 jours finissant le jour réservé : courbe par semaine. */
const QUARTER = '2033-06-06';

/** Page Statistiques : courbes des ventes et des retours (phase 30). */
describe('statistiques : courbes', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let companyId: string;
  let v07Id: string;
  let orderId: string;
  let orderTotal: number;
  let thonProductId: string;
  let thonRevenue: number;
  let otherVariantId: string;
  const get = <T>(path: string) => call<T>(t.url, 'GET', path, { token: sup });

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    companyId = (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
    const phones = new Phones(t, { 'DISTRI-ORAN': sup });
    const products = (await get<ProductDto[]>('/products?status=ACTIVE')).body;
    const thon = products.find((p) => p.variants.some((v) => v.reference === 'THON-TOM'))!;
    const other = products.find((p) => p.id !== thon.id && p.variants.length > 0)!;
    thonProductId = thon.id;
    otherVariantId = other.variants[0]!.id;
    const v07 = await phones.get('V07');
    v07Id = (
      await raw.user.findFirstOrThrow({ where: { code: 'V07', company: { code: 'DISTRI-ORAN' } } })
    ).id;

    // Une commande de deux produits : le filtre par produit ne doit compter que ses lignes
    const workdayId = await phones.startDay(v07, DAY);
    const customers = (await phones.today(v07, DAY)).body.day.customers.map((c) => c.id);
    const visitId = await phones.startVisit(v07, customers[0]!, 'PHONE');
    orderId = uuidv7();
    const ordered = await phones.send(v07, 'order.confirm', {
      orderId,
      number: `ST-${v07.series}3001`,
      visitId,
      lines: [
        {
          variantId: thon.variants.find((v) => v.reference === 'THON-TOM')!.id,
          unitId: thon.units.find((u) => u.name === 'carton')!.id,
          qty: 2,
        },
        { variantId: otherVariantId, unitId: other.units[0]!.id, qty: 1 },
      ],
    });
    expect(ordered.status, JSON.stringify(ordered)).toBe('APPLIED');
    await phones.closeDay(v07, workdayId);
    const order = await raw.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { orderLines: true },
    });
    orderTotal = Number(order.totalAmount);
    thonRevenue = order.orderLines
      .filter((l) => l.productId === thonProductId && l.kind === 'NORMAL')
      .reduce((sum, l) => sum + Number(l.lineAmount), 0);
    expect(thonRevenue).toBeGreaterThan(0);
    expect(thonRevenue).toBeLessThan(orderTotal);
  });

  afterAll(async () => {
    await raw.order.updateMany({ where: { id: orderId }, data: { status: 'CANCELLED' } });
    await raw.returnFact.deleteMany({ where: { companyId, date: new Date(`${DAY}T00:00:00Z`) } });
    await t.close();
  });

  describe('ventes dans le temps', () => {
    it('par jour : commandes et chiffre d’affaires, comme le rapport commercial', async () => {
      const reply = await get<SalesTrendDto>(`/reports/sales-trend?from=${DAY}&to=${DAY}`);
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body).toEqual({
        unit: 'DAY',
        points: [{ start: DAY, orders: 1, revenue: orderTotal }],
      });
    });

    it('filtre par produit : seules les lignes du produit comptent', async () => {
      const reply = await get<SalesTrendDto>(
        `/reports/sales-trend?from=${DAY}&to=${DAY}&productId=${thonProductId}`,
      );
      expect(reply.body.points).toEqual([{ start: DAY, orders: 1, revenue: thonRevenue }]);
    });

    it('filtre par vendeur : rien pour un autre vendeur', async () => {
      const v08 = await raw.user.findFirstOrThrow({
        where: { code: 'V08', company: { code: 'DISTRI-ORAN' } },
      });
      const reply = await get<SalesTrendDto>(
        `/reports/sales-trend?from=${DAY}&to=${DAY}&userId=${v08.id}`,
      );
      expect(reply.body.points).toEqual([{ start: DAY, orders: 0, revenue: 0 }]);
    });

    it('90 jours : par semaine (samedi), semaines vides comprises, mêmes totaux', async () => {
      const query = `from=${QUARTER}&to=${DAY}&userId=${v07Id}`;
      const [trend, commercial] = await Promise.all([
        get<SalesTrendDto>(`/reports/sales-trend?${query}`),
        get<CommercialReportDto>(`/reports/commercial?${query}`),
      ]);
      expect(trend.body.unit).toBe('WEEK');
      const starts = trend.body.points.map((p) => p.start);
      expect(starts.every((s) => new Date(`${s}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
      for (let i = 1; i < starts.length; i++)
        expect(Date.parse(starts[i]!) - Date.parse(starts[i - 1]!)).toBe(7 * 86_400_000);
      expect(starts.at(-1)).toBe(DAY);
      const sum = (key: 'orders' | 'revenue') => trend.body.points.reduce((s, p) => s + p[key], 0);
      expect(sum('revenue')).toBe(commercial.body.byDay.reduce((s, d) => s + d.revenue, 0));
      expect(sum('orders')).toBe(commercial.body.byDay.reduce((s, d) => s + d.orders, 0));
    });

    it('période invalide : 400', async () => {
      expect((await get(`/reports/sales-trend?from=${DAY}&to=${QUARTER}`)).status).toBe(400);
    });
  });

  describe('retours dans le temps (module RETURNS_ANALYSIS)', () => {
    const setModule = async (active: boolean) => {
      if (active)
        await raw.companyModule.upsert({
          where: { companyId_moduleCode: { companyId, moduleCode: 'RETURNS_ANALYSIS' } },
          create: {
            id: uuidv7(),
            companyId,
            moduleCode: 'RETURNS_ANALYSIS',
            activatedAt: new Date(),
          },
          update: { status: 'ACTIVE' },
        });
      else
        await raw.companyModule.deleteMany({
          where: { companyId, moduleCode: 'RETURNS_ANALYSIS' },
        });
      t.app.get(ModulesService).invalidate(companyId);
    };
    afterAll(() => setModule(false));

    it('module inactif : 403', async () => {
      expect((await get(`/returns/trend?from=${DAY}&to=${DAY}`)).status).toBe(403);
    });

    it('par jour : refusé, retourné, revendu ; filtres par livreur et produit', async () => {
      await setModule(true);
      const driver = await raw.user.findFirstOrThrow({
        where: { code: 'L01', company: { code: 'DISTRI-ORAN' } },
      });
      const variant = await raw.productVariant.findUniqueOrThrow({
        where: { id: otherVariantId },
      });
      const fact = (kind: 'REFUSAL' | 'RETURN' | 'RESALE', value: number, extra = {}) => ({
        id: uuidv7(),
        kind,
        date: new Date(`${DAY}T00:00:00Z`),
        qty: 1,
        value: BigInt(value),
        companyId,
        productVariantId: variant.id,
        productId: variant.productId,
        ...extra,
      });
      await raw.returnFact.createMany({
        data: [
          fact('REFUSAL', 500, { driverUserId: driver.id, orderId }),
          fact('RETURN', 300),
          fact('RESALE', 200, { driverUserId: driver.id }),
        ],
      });

      const all = await get<ReturnsTrendDto>(`/returns/trend?from=${DAY}&to=${DAY}`);
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.unit).toBe('DAY');
      expect(all.body.points).toHaveLength(1);
      expect(all.body.points[0]).toMatchObject({
        start: DAY,
        refusedValue: 500,
        returnedValue: 300,
        resoldValue: 200,
      });
      expect(all.body.points[0]!.refusalRate).toHaveProperty('insufficient');

      const byDriver = await get<ReturnsTrendDto>(
        `/returns/trend?from=${DAY}&to=${DAY}&driverId=${driver.id}`,
      );
      expect(byDriver.body.points[0]).toMatchObject({
        refusedValue: 500,
        returnedValue: 0,
        resoldValue: 200,
      });
      const byProduct = await get<ReturnsTrendDto>(
        `/returns/trend?from=${DAY}&to=${DAY}&productId=${thonProductId}`,
      );
      expect(byProduct.body.points[0]).toMatchObject({
        refusedValue: 0,
        returnedValue: 0,
        resoldValue: 0,
      });
    });
  });
});
