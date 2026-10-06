import type { LotDto, ProductDto, ReceiptDto, SupplierDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Fournisseurs, lots, refus, retours et analyse des retours (phase 21). */
describe('analyse des retours (phase 21)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let products: ProductDto[];
  let depotId: string;
  /** Stock de l'entreprise avant la suite, rétabli ensuite (les autres suites le lisent). */
  let stockBefore: { id: string; physicalQty: number; reservedQty: number }[] = [];
  let companyId: string;

  function item(variantReference: string, unitName = 'carton') {
    const product = products.find((p) => p.variants.some((v) => v.reference === variantReference))!;
    const unit = product.units.find((u) => u.name === unitName)!;
    return {
      productId: product.id,
      variantId: product.variants.find((v) => v.reference === variantReference)!.id,
      unitId: unit.id,
      baseQty: unit.baseQty,
    };
  }

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    companyId = (await raw.company.findFirstOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
    stockBefore = await raw.stock.findMany({
      where: { companyId },
      select: { id: true, physicalQty: true, reservedQty: true },
    });
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    products = (await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup }))
      .body;
    depotId = (
      await raw.warehouse.findFirstOrThrow({ where: { companyId, type: 'DEPOT', code: 'DEPOT' } })
    ).id;
  });

  afterAll(async () => {
    const known = new Set(stockBefore.map((s) => s.id));
    for (const s of stockBefore)
      await raw.stock.update({
        where: { id: s.id },
        data: { physicalQty: s.physicalQty, reservedQty: s.reservedQty },
      });
    const created = await raw.stock.findMany({ where: { companyId } });
    for (const s of created.filter((x) => !known.has(x.id)))
      await raw.stock.update({ where: { id: s.id }, data: { physicalQty: 0, reservedQty: 0 } });
    await t.close();
  });

  describe('fournisseurs et lots', () => {
    let supplier: SupplierDto;

    it('crée un fournisseur ; un nom déjà pris est refusé', async () => {
      const created = await call<SupplierDto>(t.url, 'POST', '/suppliers', {
        token: sup,
        body: { name: 'Conserverie du Sud', phone: '0550 11 22 33' },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      supplier = created.body;
      expect(supplier).toMatchObject({ name: 'Conserverie du Sud', isActive: true });
      const again = await call(t.url, 'POST', '/suppliers', {
        token: sup,
        body: { name: 'Conserverie du Sud' },
      });
      expect(again.status).toBe(409);
      const list = await call<SupplierDto[]>(t.url, 'GET', '/suppliers', { token: sup });
      expect(list.body.map((s) => s.id)).toContain(supplier.id);
      const renamed = await call<SupplierDto>(t.url, 'PATCH', `/suppliers/${supplier.id}`, {
        token: sup,
        body: { phone: null },
      });
      expect(renamed.body.phone).toBeNull();
    });

    it("rattache le fournisseur habituel d'un produit", async () => {
      const thon = item('THON-TOM');
      const updated = await call<ProductDto>(t.url, 'PATCH', `/products/${thon.productId}`, {
        token: sup,
        body: { supplierId: supplier.id },
      });
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.supplierId).toBe(supplier.id);
    });

    it("crée le lot à l'entrée en stock, puis cumule sa quantité reçue", async () => {
      const thon = item('THON-TOM');
      const receive = (qty: number) =>
        call<ReceiptDto>(t.url, 'POST', '/stock/receipts', {
          token: sup,
          body: {
            warehouseId: depotId,
            supplierId: supplier.id,
            lines: [
              {
                variantId: thon.variantId,
                unitId: thon.unitId,
                qty,
                lotNumber: 'L-2027-06',
                expiresAt: '2028-01-31',
              },
            ],
          },
        });
      const first = await receive(2);
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(first.body.supplierRef).toEqual({ id: supplier.id, name: 'Conserverie du Sud' });
      expect(first.body.lines[0]).toMatchObject({
        lotNumber: 'L-2027-06',
        expiresAt: '2028-01-31',
      });
      expect((await receive(1)).status).toBe(201);
      const lots = await call<LotDto[]>(t.url, 'GET', `/lots?variantId=${thon.variantId}`, {
        token: sup,
      });
      expect(lots.status).toBe(200);
      expect(lots.body.find((l) => l.number === 'L-2027-06')).toMatchObject({
        receivedQty: 3 * thon.baseQty,
        expiresAt: '2028-01-31',
        supplier: { id: supplier.id, name: 'Conserverie du Sud' },
      });
    });

    it('refuse un fournisseur inconnu à l’entrée', async () => {
      const thon = item('THON-TOM');
      const wrong = await call(t.url, 'POST', '/stock/receipts', {
        token: sup,
        body: {
          warehouseId: depotId,
          supplierId: '00000000-0000-7000-8000-000000000000',
          lines: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
        },
      });
      expect(wrong.status).toBe(422);
    });
  });
});
