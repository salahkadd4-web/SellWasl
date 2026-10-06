import type {
  CustomerDto,
  DeliveryPreviewDto,
  DriverRouteDto,
  LotDto,
  ProductDto,
  ReceiptDto,
  RouteCandidateDto,
  RoutePreparationDto,
  SupplierDto,
  TruckCheckLine,
  UnloadDto,
  UnloadPreviewLine,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite (commandes), livraison le dimanche. */
const DAY = '2027-06-05';
const DELIVERY = '2027-06-06';
const at = (d: string) => new Date(`${d}T00:00:00Z`);

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

  describe('livraison : refus et reventes (BR-RET-01)', () => {
    let phones: Phones;
    let driver: Phone;
    let driverWorkday: string;
    let driverUserId: string;
    let routeId: string;
    let receipt = 0;
    const orders: Record<string, { id: string; customer: CustomerDto }> = {};
    const nextNumber = () => `L01-${driver.series}${String(++receipt + 600).padStart(4, '0')}`;
    const line = (ref: string, qty: number) => {
      const i = item(ref);
      return { variantId: i.variantId, unitId: i.unitId, qty };
    };
    const reasonOf = async (kind: 'REFUSAL' | 'DELIVERY_FAILURE', where: object) =>
      (await raw.reason.findFirstOrThrow({ where: { companyId, kind, ...where } })).id;
    const myRoute = async () =>
      (await call<DriverRouteDto>(t.url, 'GET', '/me/route', { token: driver.token })).body;
    const deliveryOf = async (key: string) =>
      (await myRoute()).deliveries.find((d) => d.orderId === orders[key]!.id)!;
    const factsOf = (deliveryId: string) =>
      raw.returnFact.findMany({ where: { deliveryId }, orderBy: { kind: 'asc' } });

    async function customersOf(p: Phone) {
      const day = (await phones.today(p, DAY)).body.day;
      const list: CustomerDto[] = [];
      for (const c of day.customers)
        list.push(
          (await call<CustomerDto>(t.url, 'GET', `/customers/${c.id}`, { token: sup })).body,
        );
      return list;
    }

    async function order(
      p: Phone,
      key: string,
      customer: CustomerDto,
      lines: unknown[],
      n: number,
    ) {
      const visitId = await phones.startVisit(p, customer.id, 'PHONE');
      const orderId = uuidv7();
      const reply = await phones.send(p, 'order.confirm', {
        orderId,
        number: `R${key}-${p.series}21${String(n).padStart(2, '0')}`,
        visitId,
        lines,
      });
      expect(reply.status, JSON.stringify(reply)).toBe('APPLIED');
      orders[key] = { id: orderId, customer };
    }

    beforeAll(async () => {
      phones = new Phones(t, { 'DISTRI-ORAN': sup });
      const v07 = await phones.get('V07');
      const w07 = await phones.startDay(v07, DAY);
      const c07 = await customersOf(v07);
      await order(v07, 'A', c07[0]!, [line('THON-TOM', 6)], 1);
      await order(v07, 'B', c07[1]!, [line('THON-TOM', 2)], 2);
      await phones.closeDay(v07, w07);
      const v08 = await phones.get('V08');
      const w08 = await phones.startDay(v08, DAY);
      const c08 = await customersOf(v08);
      await order(v08, 'C', c08[0]!, [line('THON-HUI', 2)], 1);
      await order(v08, 'D', c08[1]!, [line('BIMO-CHOC', 1)], 2);
      await phones.closeDay(v08, w08);

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
      await call(t.url, 'POST', `/routes/${routeId}/prepare`, {
        token: sup,
        body: {
          lines: view.orders
            .flatMap((o) => o.lines)
            .map((l) => ({ lineId: l.lineId, preparedQty: l.defaultPrepared })),
        },
      });
      expect((await call(t.url, 'POST', `/routes/${routeId}/load`, { token: sup })).status).toBe(
        201,
      );

      driver = await phones.get('L01');
      driverUserId = (await raw.user.findFirstOrThrow({ where: { companyId, code: 'L01' } })).id;
      driverWorkday = uuidv7();
      const started = await phones.send(driver, 'workday.start', {
        workdayId: driverWorkday,
        date: DELIVERY,
      });
      expect(started.status, JSON.stringify(started)).toBe('APPLIED');
      const toCheck = (
        await call<TruckCheckLine[]>(t.url, 'GET', '/me/truck-check', { token: driver.token })
      ).body;
      const checked = await phones.send(driver, 'truck.check', {
        lines: toCheck.map((l) => ({ variantId: l.variantId, countedQty: l.inTruck })),
      });
      expect(checked.status, JSON.stringify(checked)).toBe('APPLIED');
    });

    afterAll(async () => {
      // Commandes annulées, tournée et journées closes : les autres suites ne les voient plus
      await raw.order.updateMany({
        where: { id: { in: Object.values(orders).map((o) => o.id) } },
        data: { status: 'CANCELLED' },
      });
      await raw.deliveryRoute.updateMany({ where: { id: routeId }, data: { status: 'CLOSED' } });
      await raw.workday.updateMany({
        where: { companyId, date: { in: [at(DAY), at(DELIVERY)] } },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    });

    it('livraison partielle : le motif de refus est obligatoire, puis un refus par ligne réduite', async () => {
      const a = await deliveryOf('A');
      const thon = item('THON-TOM');
      const lines = a.lines
        .filter((l) => l.kind === 'NORMAL')
        .map((l) => ({
          lineId: l.lineId,
          qty: l.variantId === thon.variantId ? 4 : l.preparedQty,
        }));
      const priced = await call<DeliveryPreviewDto>(t.url, 'POST', '/me/deliveries/preview', {
        token: driver.token,
        body: { orderId: a.orderId, lines, added: [] },
      });
      const base = { orderId: a.orderId, lines, added: [], cashAmount: priced.body.dueAmount };
      const missing = await phones.send(driver, 'delivery.confirm', {
        ...base,
        deliveryId: uuidv7(),
        number: nextNumber(),
      });
      expect(missing.status).toBe('REJECTED');
      expect(JSON.stringify(missing)).toContain('motif du refus');

      const price = await reasonOf('REFUSAL', { label: 'Prix' });
      const deliveryId = uuidv7();
      const done = await phones.send(driver, 'delivery.confirm', {
        ...base,
        deliveryId,
        number: nextNumber(),
        refusalReasonId: price,
      });
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      expect(await raw.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({
        refusalReasonId: price,
        contestStatus: 'NONE',
      });
      const ordered = await raw.order.findUniqueOrThrow({
        where: { id: a.orderId },
        include: { customer: true, orderLines: { where: { kind: 'NORMAL' } } },
      });
      const facts = await factsOf(deliveryId);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        kind: 'REFUSAL',
        productVariantId: thon.variantId,
        qty: 2 * thon.baseQty,
        sellerUserId: ordered.sellerUserId,
        driverUserId: driverUserId,
        customerId: ordered.customerId,
        territoryId: ordered.customer.territoryId,
        routeId,
        orderId: a.orderId,
        reasonId: price,
        date: at(DELIVERY),
      });
      // Valeur au prix de la commande, avant tout recalcul
      const ordinal = a.lines.find((l) => l.variantId === thon.variantId)!;
      expect(facts[0]!.value).toBe(BigInt(2 * ordinal.unitPrice));
      expect(ordered.orderLines[0]!.addedQty).toBe(0);
    });

    it('échec « refus » : le motif est obligatoire, toute la commande est refusée', async () => {
      const refused = await reasonOf('DELIVERY_FAILURE', { systemCode: 'REFUSED' });
      const failWith = (refusalReasonId?: string) =>
        phones.send(driver, 'delivery.fail', {
          deliveryId: uuidv7(),
          number: nextNumber(),
          orderId: orders.B!.id,
          reasonId: refused,
          ...(refusalReasonId && { refusalReasonId }),
        });
      const missing = await failWith();
      expect(missing.status).toBe('REJECTED');
      expect(JSON.stringify(missing)).toContain('motif du refus');
      const stock = await reasonOf('REFUSAL', { label: 'Stock suffisant' });
      const done = await failWith(stock);
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      const delivery = await raw.delivery.findFirstOrThrow({ where: { orderId: orders.B!.id } });
      expect(delivery.refusalReasonId).toBe(stock);
      const facts = await factsOf(delivery.id);
      const thon = item('THON-TOM');
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ kind: 'REFUSAL', qty: 2 * thon.baseQty, reasonId: stock });
    });

    it('revend en tournée la marchandise refusée : quantité ajoutée gardée et fait RESALE', async () => {
      const c = await deliveryOf('C');
      const thon = item('THON-TOM');
      const body = {
        orderId: c.orderId,
        lines: c.lines
          .filter((l) => l.kind === 'NORMAL')
          .map((l) => ({ lineId: l.lineId, qty: l.preparedQty })),
        added: [{ variantId: thon.variantId, unitId: thon.unitId, qty: 1 }],
      };
      const priced = await call<DeliveryPreviewDto>(t.url, 'POST', '/me/deliveries/preview', {
        token: driver.token,
        body,
      });
      expect(priced.status, JSON.stringify(priced.body)).toBe(200);
      const deliveryId = uuidv7();
      const done = await phones.send(driver, 'delivery.confirm', {
        ...body,
        deliveryId,
        number: nextNumber(),
        cashAmount: priced.body.dueAmount,
      });
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      const added = await raw.orderLine.findFirstOrThrow({
        where: { orderId: c.orderId, productVariantId: thon.variantId },
      });
      expect(added.addedQty).toBe(thon.baseQty);
      const facts = await factsOf(deliveryId);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        kind: 'RESALE',
        qty: thon.baseQty,
        value: BigInt(Number(added.unitPrice)),
        supplierId: expect.any(String),
      });
    });

    it('client absent : aucun fait de refus', async () => {
      const absent = await reasonOf('DELIVERY_FAILURE', { systemCode: 'CUSTOMER_ABSENT' });
      const deliveryId = uuidv7();
      const done = await phones.send(driver, 'delivery.fail', {
        deliveryId,
        number: nextNumber(),
        orderId: orders.D!.id,
        reasonId: absent,
      });
      expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      expect(await factsOf(deliveryId)).toHaveLength(0);
    });

    describe('déchargement : état constaté, perte, retours et écarts', () => {
      let preview: UnloadPreviewLine[];
      let photoKey: string;
      let lotId: string;
      const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64',
      );
      const unload = (body: Record<string, unknown>) =>
        call<UnloadDto>(t.url, 'POST', '/unloads', {
          token: sup,
          body: { workdayId: driverWorkday, ...body },
        });
      /** Compté : tout le théorique, sauf une unité de thon tomate manquante. */
      const counted = () =>
        preview.map((l) => ({
          variantId: l.variantId,
          countedQty:
            l.variantId === item('THON-TOM').variantId ? l.theoretical - 1 : l.theoretical,
          ...(l.variantId === item('THON-TOM').variantId && { reasonId: gapReason }),
        }));
      let gapReason: string;

      beforeAll(async () => {
        await phones.closeDay(driver, driverWorkday);
        preview = (
          await call<UnloadPreviewLine[]>(
            t.url,
            'GET',
            `/unloads/preview?workdayId=${driverWorkday}`,
            { token: sup },
          )
        ).body;
        gapReason = (
          await raw.reason.findFirstOrThrow({
            where: { companyId, kind: 'ADJUSTMENT', label: 'Marchandise manquante' },
          })
        ).id;
        lotId = (await raw.lot.findFirstOrThrow({ where: { companyId, number: 'L-2027-06' } })).id;
        const form = new FormData();
        form.append('file', new Blob([PNG], { type: 'image/png' }), 'casse.png');
        const uploaded = await fetch(`${t.url}/unloads/photos`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sup}` },
          body: form,
        });
        expect(uploaded.status).toBe(201);
        photoKey = ((await uploaded.json()) as { key: string }).key;
      });

      it('refuse une répartition qui ne fait pas le compté, ou un défectueux sans photo', async () => {
        const thon = item('THON-TOM');
        const total = preview.find((l) => l.variantId === thon.variantId)!.theoretical - 1;
        const wrongSum = await unload({
          lines: counted(),
          conditions: [{ variantId: thon.variantId, condition: 'RESTOCK', qty: total - 1 }],
        });
        expect(wrongSum.status).toBe(422);
        const noPhoto = await unload({
          lines: counted(),
          conditions: [
            { variantId: thon.variantId, condition: 'RESTOCK', qty: total - 1 },
            { variantId: thon.variantId, condition: 'DEFECTIVE', qty: 1 },
          ],
        });
        expect(noPhoto.status).toBe(422);
        expect(JSON.stringify(noPhoto.body)).toContain('photo');
        const bimo = preview.find((l) => l.variantId === item('BIMO-CHOC').variantId);
        if (bimo && bimo.theoretical > 0) {
          const wrongLot = await unload({
            lines: counted(),
            conditions: [
              {
                variantId: bimo.variantId,
                condition: 'EXPIRED',
                qty: bimo.theoretical,
                lotId,
              },
            ],
          });
          expect(wrongLot.status).toBe(422);
        }
        expect(await raw.unload.findFirst({ where: { workdayId: driverWorkday } })).toBeNull();
      });

      it('seul le remis en stock revient au dépôt ; le reste sort en perte, avec ses faits', async () => {
        const thon = item('THON-TOM');
        const total = preview.find((l) => l.variantId === thon.variantId)!.theoretical - 1;
        const restock = total - thon.baseQty - 2;
        const done = await unload({
          lines: counted(),
          conditions: [
            { variantId: thon.variantId, condition: 'RESTOCK', qty: restock },
            {
              variantId: thon.variantId,
              condition: 'DEFECTIVE',
              qty: thon.baseQty,
              lotId,
              photoKey,
            },
            { variantId: thon.variantId, condition: 'BROKEN', qty: 2 },
          ],
        });
        expect(done.status, JSON.stringify(done.body)).toBe(201);
        const unloadId = done.body.id;
        const thonLine = done.body.lines.find((l) => l.variantId === thon.variantId)!;
        expect(thonLine.conditions).toHaveLength(3);
        expect(thonLine.conditions.find((c) => c.condition === 'DEFECTIVE')).toMatchObject({
          qty: thon.baseQty,
          lot: 'L-2027-06',
          photoUrl: expect.stringContaining('/media/'),
        });

        const moves = await raw.stockMovement.findMany({
          where: { sourceType: 'UNLOAD', sourceId: unloadId, productVariantId: thon.variantId },
        });
        expect(moves.find((m) => m.type === 'WRITE_OFF')).toMatchObject({
          qty: thon.baseQty + 2,
          fromWarehouseId: (
            await raw.warehouse.findFirstOrThrow({
              where: { companyId, code: 'TRUCK-01' },
            })
          ).id,
        });
        expect(moves.find((m) => m.type === 'TRANSFER')).toMatchObject({
          qty: restock,
          toWarehouseId: depotId,
        });

        const facts = await raw.returnFact.findMany({ where: { unloadId } });
        const thonFacts = facts.filter((f) => f.productVariantId === thon.variantId);
        expect(
          thonFacts.filter((f) => f.kind === 'RETURN').map((f) => [f.condition, f.qty]),
        ).toEqual(
          expect.arrayContaining([
            ['RESTOCK', restock],
            ['DEFECTIVE', thon.baseQty],
            ['BROKEN', 2],
          ]),
        );
        const defective = thonFacts.find((f) => f.condition === 'DEFECTIVE')!;
        const supplier = await raw.supplier.findFirstOrThrow({
          where: { companyId, name: 'Conserverie du Sud' },
        });
        expect(defective).toMatchObject({
          lotId,
          supplierId: supplier.id,
          driverUserId,
          routeId,
          date: at(DELIVERY),
        });
        // Valeur au prix moyen pondéré des lignes livrées ce jour par le livreur
        const sold = await raw.orderLine.findMany({
          where: {
            productVariantId: thon.variantId,
            kind: 'NORMAL',
            deliveredQty: { gt: 0 },
            order: {
              deliveries: { some: { workdayId: driverWorkday, result: { not: 'FAILED' } } },
            },
          },
        });
        const perUnit =
          sold.reduce((s, l) => s + Number(l.lineAmount), 0) /
          sold.reduce((s, l) => s + (l.deliveredQty ?? 0), 0);
        expect(Number(defective.value)).toBe(Math.round(thon.baseQty * perUnit));
        expect(thonFacts.find((f) => f.kind === 'GAP')).toMatchObject({ qty: -1 });
        // Les autres articles comptés reviennent en entier, remis en stock
        for (const l of preview.filter((p) => p.variantId !== thon.variantId && p.theoretical > 0))
          expect(facts.find((f) => f.productVariantId === l.variantId)).toMatchObject({
            kind: 'RETURN',
            condition: 'RESTOCK',
            qty: l.theoretical,
          });
      });
    });
  });
});
