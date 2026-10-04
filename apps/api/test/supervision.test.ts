import type {
  CustomerDto,
  ObjectiveDto,
  Page,
  ProductDto,
  ProductRangeDto,
  QuotaDto,
  VisitCatalog,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

/** Écrans Web du superviseur (phase 16). */
describe('supervision (phase 16)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let phones: Phones;
  let sup: string;
  let products: ProductDto[];
  let v07: { id: string };

  const thon = () => {
    const p = products.find((x) => x.reference === 'THON-TOM')!;
    return { variantId: p.variants[0]!.id, cartonId: p.units.find((u) => u.name === 'carton')!.id };
  };

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;
    v07 = await raw.user.findFirstOrThrow({
      where: { code: 'V07', company: { code: 'DISTRI-ORAN' } },
    });
  });
  afterAll(() => t.close());

  describe('quotas du jour (UC-55)', () => {
    const date = '2026-12-05';

    it('enregistre en unité de base, montre au téléphone, supprime à 0', async () => {
      const put = (qty: number) =>
        call<QuotaDto[]>(t.url, 'PUT', '/quotas', {
          token: sup,
          body: {
            date,
            entries: [
              { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty },
            ],
          },
        });
      const saved = await put(3);
      expect(saved.status).toBe(200);
      const list = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: sup });
      expect(list.body).toContainEqual(
        expect.objectContaining({
          user: expect.objectContaining({ code: 'V07' }),
          productVariantId: thon().variantId,
          qty: 60,
          enteredQty: 3,
          consumedQty: 0,
        }),
      );

      const p = await phones.get('V07');
      const sector = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?limit=1', {
        token: p.token,
      });
      const catalog = await call<VisitCatalog>(
        t.url,
        'GET',
        `/me/visit-catalog?customerId=${sector.body.data[0]!.id}&date=${date}`,
        { token: p.token },
      );
      const variant = catalog.body.products
        .flatMap((x) => x.variants)
        .find((v) => v.id === thon().variantId);
      expect(variant).toMatchObject({ quotaRemaining: 60, quotaReached: false });

      expect((await put(0)).status).toBe(200);
      const after = await call<QuotaDto[]>(t.url, 'GET', `/quotas?date=${date}`, { token: sup });
      expect(after.body.some((q) => q.productVariantId === thon().variantId)).toBe(false);
    });

    it('refuse une date passée et un utilisateur sans droit', async () => {
      const past = await call(t.url, 'PUT', '/quotas', {
        token: sup,
        body: {
          date: '2026-01-03',
          entries: [
            { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 1 },
          ],
        },
      });
      expect(past.status).toBe(422);
      const p = await phones.get('V07');
      const seller = await call(t.url, 'PUT', '/quotas', {
        token: p.token,
        body: {
          date,
          entries: [
            { userId: v07.id, productVariantId: thon().variantId, unitId: thon().cartonId, qty: 1 },
          ],
        },
      });
      expect(seller.status).toBe(403);
    });
  });

  describe('objectifs du mois (UC-56)', () => {
    it('fixe la cible, la prime et le plafond, et calcule le réalisé', async () => {
      const ranges = await call<ProductRangeDto[]>(t.url, 'GET', '/product-ranges', {
        token: sup,
      });
      const bimo = ranges.body.find((r) => r.code === 'BIMO')!;
      const put = await call<ObjectiveDto[]>(t.url, 'PUT', '/objectives', {
        token: sup,
        body: {
          month: '2026-12',
          entries: [
            {
              userId: v07.id,
              rangeId: bimo.id,
              targetAmount: 1_000_000,
              bonusAmount: 10_000,
              capPercent: 120,
            },
          ],
        },
      });
      expect(put.status).toBe(200);
      const list = await call<ObjectiveDto[]>(t.url, 'GET', '/objectives?month=2026-12', {
        token: sup,
      });
      expect(list.body).toContainEqual(
        expect.objectContaining({
          user: expect.objectContaining({ code: 'V07' }),
          range: expect.objectContaining({ code: 'BIMO' }),
          targetAmount: 1_000_000,
          bonusAmount: 10_000,
          capPercent: 120,
          realizedAmount: 0,
          estimatedBonus: 0,
        }),
      );
      const p = await phones.get('V07');
      expect(
        (
          await call(t.url, 'PUT', '/objectives', {
            token: p.token,
            body: { month: '2026-12', entries: [] },
          })
        ).status,
      ).toBe(403);
    });
  });
});
