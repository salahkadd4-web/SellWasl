import type { OrderDto, Page } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, platformLogin, startApp, type TestApp, webLogin } from './helpers';

/** Jour lointain : les commandes de test ne croisent aucun autre test. */
const DAY = '2031-03-04';

/** Pagination et tri des listes qui grossissent (api.md §1, phase 25). */
describe('pagination et tri (phase 25)', () => {
  let t: TestApp;
  let adm: string;
  let raw: PrismaService;
  const workdayId = uuidv7();

  beforeAll(async () => {
    t = await startApp();
    adm = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    raw = t.app.get(PrismaService);
    // Sept commandes annulées le même jour, montants en partie égaux (tri non unique)
    const company = await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    const seller = await raw.user.findFirstOrThrow({
      where: { companyId: company.id, code: 'V07' },
    });
    const customer = await raw.customer.findFirstOrThrow({
      where: { companyId: company.id, deletedAt: null },
    });
    await raw.workday.create({
      data: {
        id: workdayId,
        companyId: company.id,
        userId: seller.id,
        date: new Date(`${DAY}T00:00:00Z`),
        status: 'CLOSED',
        settingsVersion: 1,
      },
    });
    await raw.order.createMany({
      data: [500, 300, 500, 100, 300, 500, 200].map((amount, i) => ({
        id: uuidv7(),
        number: `PAGE-${Date.now()}-${i}`,
        source: 'PRE_SALES' as const,
        status: 'CANCELLED' as const,
        orderDate: new Date(`${DAY}T00:00:00Z`),
        totalAmount: BigInt(amount),
        companyId: company.id,
        sellerUserId: seller.id,
        customerId: customer.id,
        customerTypeId: customer.customerTypeId,
        workdayId,
      })),
    });
  });
  afterAll(async () => {
    await raw.order.deleteMany({ where: { workdayId } });
    await raw.workday.delete({ where: { id: workdayId } });
    await t.close();
  });

  const page = <T>(path: string, token = adm) => call<Page<T>>(t.url, 'GET', path, { token });

  /** Toutes les pages d'une liste, curseur après curseur. */
  async function walk<T extends { id: string }>(path: string, limit: number) {
    const rows: T[] = [];
    let cursor: string | null = null;
    let total = -1;
    for (let i = 0; i < 400; i += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const reply = await page<T>(
        `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body.data.length).toBeLessThanOrEqual(limit);
      rows.push(...reply.body.data);
      total = reply.body.total;
      cursor = reply.body.nextCursor;
      if (!cursor) break;
    }
    return { rows, total };
  }

  it('commandes parcourues page par page : chaque commande une fois, aucune perdue', async () => {
    // Tri par date de commande : sept commandes le même jour (tri non unique)
    const small = await walk<OrderDto>(`/orders?date=${DAY}&sort=-orderDate`, 3);
    const big = await walk<OrderDto>(`/orders?date=${DAY}&sort=-orderDate`, 200);
    expect(small.total).toBe(7);
    expect(small.rows.length).toBe(small.total);
    expect(new Set(small.rows.map((o) => o.id)).size).toBe(small.rows.length);
    expect(small.rows.map((o) => o.id)).toEqual(big.rows.map((o) => o.id));
    const dates = small.rows.map((o) => o.orderDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('tri par montant décroissant', async () => {
    const { rows } = await walk<OrderDto>(`/orders?date=${DAY}&sort=-totalAmount`, 2);
    expect(rows.map((o) => o.totalAmount)).toEqual([500, 500, 500, 300, 300, 200, 100]);
    expect(new Set(rows.map((o) => o.id)).size).toBe(7);
    const up = await walk<OrderDto>(`/orders?date=${DAY}&sort=totalAmount`, 3);
    expect(up.rows.map((o) => o.totalAmount)).toEqual([100, 200, 300, 300, 500, 500, 500]);
  });

  it('limite, tri et curseur invalides : 400 VALIDATION_ERROR', async () => {
    for (const query of ['limit=500', 'limit=0', 'sort=inconnu', 'sort=customerId', 'cursor=abc']) {
      const reply = await call<{ error: { code: string } }>(t.url, 'GET', `/orders?${query}`, {
        token: adm,
      });
      expect(reply.status, query).toBe(400);
      expect(reply.body.error.code, query).toBe('VALIDATION_ERROR');
    }
    // Curseur d'un autre tri : refusé plutôt que mal interprété
    const first = await page<OrderDto>(`/orders?date=${DAY}&sort=-orderDate&limit=1`);
    const reply = await call(
      t.url,
      'GET',
      `/orders?sort=-totalAmount&cursor=${encodeURIComponent(first.body.nextCursor!)}`,
      { token: adm },
    );
    expect(reply.status).toBe(400);
  });

  it('50 par défaut', async () => {
    const reply = await page<OrderDto>('/orders');
    expect(reply.body.data.length).toBe(Math.min(50, reply.body.total));
  });

  it('chaque liste qui grossit répond par pages { data, nextCursor, total }', async () => {
    const platform = await platformLogin(t.url);
    const accountant = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    const lists: [string, string?][] = [
      ['/orders'],
      ['/payments?from=2020-01-01&to=2030-12-31'],
      ['/stock/movements'],
      ['/stock/receipts?from=2020-01-01'],
      ['/inventories'],
      ['/loads'],
      ['/unloads'],
      ['/discrepancies'],
      ['/discrepancies?status=OPEN'],
      ['/advances', accountant],
      ['/deductions', accountant],
      ['/incentives', accountant],
      ['/platform/companies', platform],
    ];
    for (const [path, token] of lists) {
      const reply = await page<{ id: string }>(
        `${path}${path.includes('?') ? '&' : '?'}limit=1`,
        token,
      );
      expect(reply.status, `${path} ${JSON.stringify(reply.body)}`).toBe(200);
      expect(Array.isArray(reply.body.data), path).toBe(true);
      expect(reply.body.data.length, path).toBeLessThanOrEqual(1);
      expect(typeof reply.body.total, path).toBe('number');
      expect(reply.body.nextCursor === null || typeof reply.body.nextCursor === 'string').toBe(
        true,
      );
      if (reply.body.total > 1) expect(reply.body.nextCursor, path).toBeTruthy();
    }
  });
});
