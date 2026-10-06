import type {
  AdvanceDto,
  CompensationDto,
  CustomerDto,
  DeductionDto,
  DeliveryPreviewDto,
  DiscrepancyDto,
  DriverRouteDto,
  IncentiveDto,
  IncentiveProgressDto,
  IncentiveRuleDto,
  MyPayDto,
  PayrollAdjustmentDto,
  PayrollDashboardDto,
  PayrollPeriodDto,
  PayrollSettings,
  ProductDto,
  RouteCandidateDto,
  RoutePreparationDto,
  SettlementDetailDto,
  TruckCheckLine,
  UnloadDto,
  UnloadPreviewLine,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PayrollAutomationService } from '../src/payroll/payroll-automation.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite (commandes), livraison le dimanche, paie d'août 2027. */
const DAY = '2027-08-07';
const DELIVERY = '2027-08-08';
const MONTH = '2027-08';
const at = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * Paie, primes, acomptes, retenues et écarts (phase 21 bis) : scénario de bout en bout de la
 * mission, avec le livreur L01 dans le rôle d'« Ahmed ».
 */
describe('paie : scénario E2E du livreur', () => {
  let t: TestApp;
  let raw: PrismaService;
  let companyId: string;
  let admin: string;
  let sup: string;
  let accountant: string;
  let phones: Phones;
  let driver: Phone;
  let driverId: string;
  let driverWorkday: string;
  let routeId: string;
  let couscous: ProductDto;
  let settingsBefore: unknown;
  let stockBefore: { id: string; physicalQty: number; reservedQty: number }[] = [];
  const orders: Record<string, { id: string; customer: CustomerDto }> = {};
  let receipt = 0;
  const nextNumber = () => `L01-${driver.series}${String(++receipt + 800).padStart(4, '0')}`;
  const get = <T>(path: string, token = accountant) => call<T>(t.url, 'GET', path, { token });
  const post = <T>(path: string, body: unknown = {}, token = accountant) =>
    call<T>(t.url, 'POST', path, { token, body });

  const carton = () => {
    const variant = couscous.variants[0]!;
    const unit = couscous.units.find((u) => u.isBase)!;
    return { variantId: variant.id, unitId: unit.id };
  };

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    companyId = (await raw.company.findFirstOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
    settingsBefore = (
      await raw.companySettings.findFirstOrThrow({
        where: { companyId },
        orderBy: { version: 'desc' },
      })
    ).data;
    stockBefore = await raw.stock.findMany({
      where: { companyId },
      select: { id: true, physicalQty: true, reservedQty: true },
    });
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    accountant = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    phones = new Phones(t, { 'DISTRI-ORAN': sup });
    driverId = (await raw.user.findFirstOrThrow({ where: { companyId, code: 'L01' } })).id;

    // Produit « Couscous » vendu au carton, 1 000 DA pour tous les types de clients
    const range = await raw.productRange.findFirstOrThrow({ where: { companyId } });
    const created = await post<ProductDto>(
      '/products',
      { reference: 'COUSCOUS-E2E', name: 'Couscous', rangeId: range.id, baseUnitName: 'carton' },
      admin,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    couscous = created.body;
    const types = await raw.customerType.findMany({ where: { companyId } });
    const prices = await call(t.url, 'PUT', `/products/${couscous.id}/prices`, {
      token: admin,
      body: {
        prices: types.map((type) => ({
          variantId: null,
          customerTypeId: type.id,
          unitId: carton().unitId,
          price: 1000,
        })),
      },
    });
    expect(prices.status, JSON.stringify(prices.body)).toBe(200);
    const depot = await raw.warehouse.findFirstOrThrow({
      where: { companyId, type: 'DEPOT', code: 'DEPOT' },
    });
    const received = await post(
      '/stock/receipts',
      { warehouseId: depot.id, lines: [{ ...carton(), qty: 100 }] },
      sup,
    );
    expect(received.status, JSON.stringify(received.body)).toBe(201);

    // Deux commandes de V07 : 60 + 40 = 100 cartons, chargés dans le camion du livreur
    const v07 = await phones.get('V07');
    const workday = await phones.startDay(v07, DAY);
    const customers = (await phones.today(v07, DAY)).body.day.customers;
    for (const [key, qty, i] of [
      ['A', 60, 0],
      ['B', 40, 1],
    ] as const) {
      const customer = (
        await call<CustomerDto>(t.url, 'GET', `/customers/${customers[i]!.id}`, { token: sup })
      ).body;
      const visitId = await phones.startVisit(v07, customer.id, 'PHONE');
      const orderId = uuidv7();
      const reply = await phones.send(v07, 'order.confirm', {
        orderId,
        number: `P${key}-${v07.series}2201`,
        visitId,
        lines: [{ ...carton(), qty }],
      });
      expect(reply.status, JSON.stringify(reply)).toBe('APPLIED');
      orders[key] = { id: orderId, customer };
    }
    await phones.closeDay(v07, workday);
    const [group] = (
      await call<RouteCandidateDto[]>(t.url, 'GET', `/routes?date=${DELIVERY}`, { token: sup })
    ).body;
    const launched = await post<RouteCandidateDto>(
      '/routes/launch',
      { date: DELIVERY, driverId: group!.driver!.id },
      sup,
    );
    expect(launched.status, JSON.stringify(launched.body)).toBe(201);
    routeId = launched.body.routeId!;
    const view = (
      await call<RoutePreparationDto>(t.url, 'GET', `/routes/${routeId}/preparation`, {
        token: sup,
      })
    ).body;
    await post(
      `/routes/${routeId}/prepare`,
      {
        lines: view.orders
          .flatMap((o) => o.lines)
          .map((l) => ({ lineId: l.lineId, preparedQty: l.defaultPrepared })),
      },
      sup,
    );
    expect((await post(`/routes/${routeId}/load`, {}, sup)).status).toBe(201);

    driver = await phones.get('L01');
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
    await raw.order.updateMany({
      where: { id: { in: Object.values(orders).map((o) => o.id) } },
      data: { status: 'CANCELLED' },
    });
    await raw.deliveryRoute.updateMany({ where: { id: routeId }, data: { status: 'CLOSED' } });
    await raw.workday.updateMany({
      where: { companyId, date: { in: [at(DAY), at(DELIVERY)] } },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const known = new Set(stockBefore.map((s) => s.id));
    for (const s of stockBefore)
      await raw.stock.update({
        where: { id: s.id },
        data: { physicalQty: s.physicalQty, reservedQty: s.reservedQty },
      });
    for (const s of (await raw.stock.findMany({ where: { companyId } })).filter(
      (x) => !known.has(x.id),
    ))
      await raw.stock.update({ where: { id: s.id }, data: { physicalQty: 0, reservedQty: 0 } });
    await raw.product.update({ where: { id: couscous.id }, data: { deletedAt: new Date() } });
    const last = await raw.companySettings.findFirstOrThrow({
      where: { companyId },
      orderBy: { version: 'desc' },
    });
    await raw.companySettings.create({
      data: {
        id: uuidv7(),
        companyId,
        version: last.version + 1,
        data: settingsBefore as object,
      },
    });
    await t.close();
  });

  describe('retour du véhicule et écart de stock', () => {
    it('le livreur livre 80 cartons ; 20 sont refusés et reviennent dans le camion', async () => {
      const route = (await call<DriverRouteDto>(t.url, 'GET', '/me/route', { token: driver.token }))
        .body;
      const refusal = await raw.reason.findFirstOrThrow({
        where: { companyId, kind: 'REFUSAL', systemCode: 'OTHER' },
      });
      for (const [key, qty] of [
        ['A', 60],
        ['B', 20],
      ] as const) {
        const d = route.deliveries.find((x) => x.orderId === orders[key]!.id)!;
        const body = {
          orderId: d.orderId,
          lines: d.lines.filter((l) => l.kind === 'NORMAL').map((l) => ({ lineId: l.lineId, qty })),
          added: [],
        };
        const priced = await call<DeliveryPreviewDto>(t.url, 'POST', '/me/deliveries/preview', {
          token: driver.token,
          body,
        });
        expect(priced.body.dueAmount).toBe(qty * 1000);
        const done = await phones.send(driver, 'delivery.confirm', {
          ...body,
          deliveryId: uuidv7(),
          number: nextNumber(),
          cashAmount: priced.body.dueAmount,
          ...(key === 'B' && { refusalReasonId: refusal.id }),
        });
        expect(done.status, JSON.stringify(done)).toBe('APPLIED');
      }
    });

    it('retour au dépôt : 18 cartons comptés sur 20 théoriques, écart −2 × 1 000 DA', async () => {
      await phones.closeDay(driver, driverWorkday);
      const preview = (
        await call<UnloadPreviewLine[]>(
          t.url,
          'GET',
          `/unloads/preview?workdayId=${driverWorkday}`,
          {
            token: sup,
          },
        )
      ).body;
      const line = preview.find((l) => l.variantId === carton().variantId)!;
      expect(line).toMatchObject({ loaded: 100, delivered: 80, theoretical: 20, unitValue: 1000 });
      const missing = await raw.reason.findFirstOrThrow({
        where: { companyId, kind: 'ADJUSTMENT', label: 'Marchandise manquante' },
      });
      const unloaded = await call<UnloadDto>(t.url, 'POST', '/unloads', {
        token: sup,
        body: {
          workdayId: driverWorkday,
          lines: preview.map((l) =>
            l.variantId === carton().variantId
              ? { variantId: l.variantId, countedQty: 18, reasonId: missing.id }
              : { variantId: l.variantId, countedQty: l.theoretical },
          ),
        },
      });
      expect(unloaded.status, JSON.stringify(unloaded.body)).toBe(201);
      // Contrôle tracé : qui l'a validé et quand
      expect(unloaded.body).toMatchObject({
        validatedBy: expect.any(String),
        validatedAt: expect.any(String),
      });
      expect(unloaded.body.lines.find((l) => l.variantId === carton().variantId)).toMatchObject({
        theoretical: 20,
        counted: 18,
        gap: -2,
        unitValue: 1000,
        gapValue: -2000,
      });
    });

    it("l'écart est enregistré, validé par le contrôleur, et visible du comptable", async () => {
      const list = await get<DiscrepancyDto[]>(`/discrepancies?kind=STOCK&userId=${driverId}`);
      expect(list.status).toBe(200);
      const d = list.body.find((x) => x.date === DELIVERY && x.article === 'Couscous')!;
      expect(d).toMatchObject({
        status: 'VALIDATED',
        qty: -2,
        unitValue: 1000,
        amount: -2000,
        cause: 'Marchandise manquante',
        user: { id: driverId },
      });
      // Le magasinier, le livreur ne décident pas ; un autre rôle que le comptable non plus
      expect((await post(`/discrepancies/${d.id}/review`, {}, driver.token)).status).toBe(403);
    });
  });

  describe('rapprochement financier', () => {
    it("versement : l'écart de caisse est relié à la journée et aux écarts de marchandise", async () => {
      const created = await post('/settlements', {
        workdayId: driverWorkday,
        remittedAmount: 79_500,
        note: 'Il manque 500 DA de monnaie.',
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const detail = await get<SettlementDetailDto>(`/settlements/${driverWorkday}/detail`);
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({
        expected: 80_000,
        remitted: 79_500,
        gap: -500,
        note: 'Il manque 500 DA de monnaie.',
        sales: 80_000,
        cashSales: 80_000,
        credit: 0,
        financialDiscrepancy: { kind: 'FINANCIAL', amount: -500, status: 'VALIDATED' },
      });
      expect(detail.body.stockDiscrepancies.map((d) => d.amount)).toContain(-2000);
    });

    it("l'écart de caisse est jugé sans responsabilité (monnaie rendue)", async () => {
      const detail = (await get<SettlementDetailDto>(`/settlements/${driverWorkday}/detail`)).body;
      const decided = await post<DiscrepancyDto>(
        `/discrepancies/${detail.financialDiscrepancy!.id}/decide`,
        { decision: 'NO_LIABILITY', note: 'Monnaie rendue au client, justifiée.' },
      );
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      expect(decided.body).toMatchObject({ status: 'RESOLVED', deduction: null });
    });
  });

  describe('écart → retenue validée', () => {
    let discrepancyId: string;
    let deductionId: string;

    it('le comptable analyse, confirme la responsabilité : retenue en attente de 2 000 DA', async () => {
      const d = (
        await get<DiscrepancyDto[]>(`/discrepancies?kind=STOCK&userId=${driverId}`)
      ).body.find((x) => x.date === DELIVERY && x.article === 'Couscous')!;
      discrepancyId = d.id;
      const review = await post<DiscrepancyDto>(`/discrepancies/${d.id}/review`);
      expect(review.body.status).toBe('UNDER_REVIEW');
      const decided = await post<DiscrepancyDto>(`/discrepancies/${d.id}/decide`, {
        decision: 'LIABILITY',
        note: 'Cartons manquants au retour, responsabilité du livreur.',
      });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      expect(decided.body).toMatchObject({
        status: 'DEDUCTION_PENDING',
        deduction: { amount: 2000, status: 'PENDING' },
      });
      deductionId = decided.body.deduction!.id;
      // Une décision par écart, une retenue par écart
      const again = await post(`/discrepancies/${d.id}/decide`, {
        decision: 'LIABILITY',
        note: 'Encore',
      });
      expect(again.status).toBe(409);
    });

    it("une retenue n'est jamais appliquée sans approbation explicite", async () => {
      const approved = await post<DeductionDto>(`/deductions/${deductionId}/approve`);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body).toMatchObject({
        status: 'APPROVED',
        sourceType: 'STOCK_DISCREPANCY',
        discrepancyId,
      });
      expect((await post(`/deductions/${deductionId}/approve`)).status).toBe(409);
      const d = (await get<DiscrepancyDto[]>(`/discrepancies?userId=${driverId}`)).body.find(
        (x) => x.id === discrepancyId,
      );
      expect(d?.status).toBe('DEDUCTION_APPROVED');
    });
  });

  describe('rémunération, paramètres de paie et acompte', () => {
    it("l'administrateur fixe le salaire : historique conservé", async () => {
      const first = await post<CompensationDto>(
        '/compensations',
        { userId: driverId, baseSalary: 55_000, effectiveFrom: '2027-01-01' },
        admin,
      );
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const second = await post<CompensationDto>(
        '/compensations',
        { userId: driverId, baseSalary: 60_000, effectiveFrom: '2027-06-01', note: 'Augmentation' },
        admin,
      );
      expect(second.status).toBe(201);
      const history = (await get<CompensationDto[]>(`/compensations?userId=${driverId}`)).body;
      expect(history.map((c) => [c.baseSalary, c.effectiveFrom, c.effectiveTo])).toEqual([
        [60_000, '2027-06-01', null],
        [55_000, '2027-01-01', '2027-05-31'],
      ]);
      // Antérieure à la rémunération en cours, ou par le comptable : refusée
      expect(
        (
          await post(
            '/compensations',
            { userId: driverId, baseSalary: 1, effectiveFrom: '2027-03-01' },
            admin,
          )
        ).status,
      ).toBe(422);
      expect(
        (
          await post('/compensations', {
            userId: driverId,
            baseSalary: 1,
            effectiveFrom: '2028-01-01',
          })
        ).status,
      ).toBe(403);
    });

    it('calendrier 15 → 50 %, 30 → 50 % ; un calendrier à 80 % est refusé', async () => {
      const wrong = await call(t.url, 'PUT', '/payroll/settings', {
        token: admin,
        body: {
          enabled: true,
          advancesEnabled: true,
          schedule: [
            { day: 15, percent: 40 },
            { day: 30, percent: 40 },
          ],
        },
      });
      expect(wrong.status).toBe(400);
      const saved = await call<PayrollSettings>(t.url, 'PUT', '/payroll/settings', {
        token: admin,
        body: {
          enabled: true,
          advancesEnabled: false,
          advanceMaxPercent: 50,
          weekStartsOn: 'SAT',
          schedule: [
            { day: 15, percent: 50 },
            { day: 30, percent: 50 },
          ],
        },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.schedule).toHaveLength(2);
    });

    it('acomptes désactivés : aucune création ; activés : demande, approbation, paiement', async () => {
      const body = { userId: driverId, amount: 10_000, month: MONTH, reason: 'Rentrée scolaire' };
      expect((await post('/advances', body)).status).toBe(422);
      await call(t.url, 'PUT', '/payroll/settings', {
        token: admin,
        body: {
          enabled: true,
          advancesEnabled: true,
          advanceMaxPercent: 50,
          weekStartsOn: 'SAT',
          schedule: [
            { day: 15, percent: 50 },
            { day: 30, percent: 50 },
          ],
        },
      });
      const tooMuch = await post<AdvanceDto>('/advances', { ...body, amount: 40_000 });
      expect(tooMuch.status).toBe(201);
      expect((await post(`/advances/${tooMuch.body.id}/approve`)).status).toBe(422);
      expect(
        (await post(`/advances/${tooMuch.body.id}/reject`, { note: 'Au-delà du plafond' })).status,
      ).toBe(200);

      const created = await post<AdvanceDto>('/advances', body);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.status).toBe('REQUESTED');
      expect((await post(`/advances/${created.body.id}/pay`)).status).toBe(409);
      const approved = await post<AdvanceDto>(`/advances/${created.body.id}/approve`);
      expect(approved.body.status).toBe('APPROVED');
      const paid = await post<AdvanceDto>(`/advances/${created.body.id}/pay`);
      expect(paid.body).toMatchObject({ status: 'PAID', paidAt: expect.any(String) });
      expect((await post(`/advances/${created.body.id}/pay`)).status).toBe(409);
    });
  });

  describe('prime hebdomadaire', () => {
    let incentiveId: string;

    it('règle : 20 DA par carton de couscous livré, chaque semaine, pour le livreur', async () => {
      const rule = await post<IncentiveRuleDto>(
        '/incentive-rules',
        {
          name: 'Couscous livré',
          kind: 'PER_UNIT',
          frequency: 'WEEKLY',
          productId: couscous.id,
          amount: 20,
          userId: driverId,
          validFrom: '2027-08-01',
        },
        admin,
      );
      expect(rule.status, JSON.stringify(rule.body)).toBe(201);
      expect(
        (
          await post(
            '/incentive-rules',
            {
              name: 'Sans cible',
              kind: 'PER_UNIT',
              frequency: 'WEEKLY',
              productId: couscous.id,
              amount: 20,
              validFrom: '2027-08-01',
            },
            admin,
          )
        ).status,
      ).toBe(400);
    });

    it('fin de semaine : 80 cartons livrés × 20 DA = 1 600 DA, ventes sources tracées', async () => {
      const calc = await post<IncentiveDto[]>('/incentives/calculate', {
        date: DELIVERY,
        frequency: 'WEEKLY',
      });
      expect(calc.status, JSON.stringify(calc.body)).toBe(200);
      const mine = calc.body.find((i) => i.user.id === driverId)!;
      expect(mine).toMatchObject({
        periodStart: '2027-08-07',
        periodEnd: '2027-08-13',
        quantity: 80,
        unitAmount: 20,
        amount: 1600,
        status: 'CALCULATED',
      });
      expect(mine.details.map((d) => d.qty).sort((a, b) => a - b)).toEqual([20, 60]);
      incentiveId = mine.id;
      // Recalcul : la même prime, jamais en double
      const again = await post<IncentiveDto[]>('/incentives/calculate', {
        date: DELIVERY,
        frequency: 'WEEKLY',
      });
      expect(again.body.filter((i) => i.user.id === driverId)).toHaveLength(1);
      expect(again.body.find((i) => i.user.id === driverId)!.id).toBe(incentiveId);
    });

    it('le comptable valide la prime, une seule fois ; le recalcul ne la touche plus', async () => {
      const validated = await post<IncentiveDto>(`/incentives/${incentiveId}/validate`);
      expect(validated.body.status).toBe('VALIDATED');
      expect((await post(`/incentives/${incentiveId}/validate`)).status).toBe(409);
      const again = await post<IncentiveDto[]>('/incentives/calculate', {
        date: DELIVERY,
        frequency: 'WEEKLY',
      });
      expect(again.body.find((i) => i.id === incentiveId)?.status).toBe('VALIDATED');
    });
  });

  describe('paie du mois', () => {
    let periodId: string;

    it('calcul : 60 000 + 1 600 − 10 000 − 2 000 = 49 600 DA, chaque montant avec sa source', async () => {
      const created = await post<PayrollPeriodDto>('/payroll/periods', { month: MONTH });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      periodId = created.body.id;
      expect((await post('/payroll/periods', { month: MONTH })).status).toBe(409);
      const calculated = await post<PayrollPeriodDto>(`/payroll/periods/${periodId}/calculate`);
      expect(calculated.status, JSON.stringify(calculated.body)).toBe(200);
      expect(calculated.body.status).toBe('CALCULATED');
      const entry = calculated.body.entries.find((e) => e.user.id === driverId)!;
      expect(entry).toMatchObject({
        baseSalary: 60_000,
        earnings: 1600,
        advances: 10_000,
        deductions: 2000,
        net: 49_600,
      });
      const bySource = Object.fromEntries(entry.lines.map((l) => [l.kind, l]));
      expect(bySource.BASE_SALARY).toMatchObject({
        amount: 60_000,
        sourceType: 'EmployeeCompensation',
      });
      expect(bySource.INCENTIVE).toMatchObject({ amount: 1600, sourceType: 'Incentive' });
      expect(bySource.ADVANCE).toMatchObject({ amount: -10_000, sourceType: 'SalaryAdvance' });
      expect(bySource.DEDUCTION).toMatchObject({ amount: -2000, sourceType: 'PayrollDeduction' });
      // La retenue remonte à l'écart, l'écart à la ligne de déchargement
      const deduction = await raw.payrollDeduction.findUniqueOrThrow({
        where: { id: bySource.DEDUCTION!.sourceId! },
        include: { discrepancy: { include: { unloadLine: true } } },
      });
      expect(deduction.discrepancy?.unloadLine).toMatchObject({ countedQty: 18, gapQty: -2 });
    });

    it('ajustement contrôlé tant que la paie n’est pas approuvée ; recalcul possible', async () => {
      const adj = await post<PayrollAdjustmentDto>('/payroll/adjustments', {
        userId: driverId,
        month: MONTH,
        amount: 400,
        reason: 'Correction de test',
      });
      expect(adj.status, JSON.stringify(adj.body)).toBe(201);
      const recalculated = await post<PayrollPeriodDto>(`/payroll/periods/${periodId}/calculate`);
      expect(recalculated.body.entries.find((e) => e.user.id === driverId)!.net).toBe(50_000);
      // Annulé par un ajustement inverse : le net revient au scénario
      await post('/payroll/adjustments', {
        userId: driverId,
        month: MONTH,
        amount: -400,
        reason: 'Annulation de la correction de test',
      });
      const back = await post<PayrollPeriodDto>(`/payroll/periods/${periodId}/calculate`);
      expect(back.body.entries.find((e) => e.user.id === driverId)!.net).toBe(49_600);
    });

    it('approbation : échéances 24 800 + 24 800, sources appliquées, plus de recalcul', async () => {
      const approved = await post<PayrollPeriodDto>(`/payroll/periods/${periodId}/approve`);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(approved.body.status).toBe('APPROVED');
      const entry = approved.body.entries.find((e) => e.user.id === driverId)!;
      expect(entry.payments.map((p) => [p.dueDate, p.amount])).toEqual([
        ['2027-08-15', 24_800],
        ['2027-08-30', 24_800],
      ]);
      expect((await post(`/payroll/periods/${periodId}/calculate`)).status).toBe(409);
      expect((await post(`/payroll/periods/${periodId}/approve`)).status).toBe(409);
      const d = (await get<DeductionDto[]>(`/deductions?userId=${driverId}`)).body[0]!;
      expect(d.status).toBe('APPLIED');
      const disc = (
        await get<DiscrepancyDto[]>(`/discrepancies?userId=${driverId}&kind=STOCK`)
      ).body.find((x) => x.date === DELIVERY);
      expect(disc?.status).toBe('DEDUCTION_APPLIED');
      const advances = (await get<AdvanceDto[]>(`/advances?userId=${driverId}&month=${MONTH}`))
        .body;
      expect(advances.find((a) => a.amount === 10_000)?.status).toBe('DEDUCTED');
    });

    it('paiement : chaque échéance une seule fois, puis clôture ; plus aucune modification', async () => {
      const period = (await get<PayrollPeriodDto>(`/payroll/periods/${periodId}`)).body;
      const payments = period.entries.find((e) => e.user.id === driverId)!.payments;
      expect((await post(`/payroll/periods/${periodId}/close`)).status).toBe(409);
      for (const p of payments) {
        const paid = await post(`/payroll/payments/${p.id}/pay`);
        expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      }
      expect((await post(`/payroll/payments/${payments[0]!.id}/pay`)).status).toBe(409);
      const paidPeriod = (await get<PayrollPeriodDto>(`/payroll/periods/${periodId}`)).body;
      expect(paidPeriod.status).toBe('PAID');
      expect(paidPeriod.totals.paid).toBe(paidPeriod.totals.net);
      const closed = await post<PayrollPeriodDto>(`/payroll/periods/${periodId}/close`);
      expect(closed.body.status).toBe('CLOSED');
      expect((await post(`/payroll/periods/${periodId}/calculate`)).status).toBe(409);
      expect(
        (
          await post('/payroll/adjustments', {
            userId: driverId,
            month: MONTH,
            amount: 100,
            reason: 'Trop tard',
          })
        ).status,
      ).toBe(409);
    });

    it('tableau de bord du mois', async () => {
      const dash = await get<PayrollDashboardDto>(`/payroll/dashboard?month=${MONTH}`);
      expect(dash.status).toBe(200);
      expect(dash.body).toMatchObject({ month: MONTH, payrollStatus: 'CLOSED', net: 49_600 });
      expect(dash.body.employees).toBeGreaterThanOrEqual(1);
    });
  });

  describe('automatisation et progression', () => {
    it('progression en direct : la semaine en cours, sans rien enregistrer', async () => {
      const progress = await call<IncentiveProgressDto[]>(
        t.url,
        'GET',
        '/me/incentives/progress?date=2027-08-10',
        { token: driver.token },
      );
      expect(progress.status).toBe(200);
      expect(progress.body.find((p) => p.rule.name === 'Couscous livré')).toMatchObject({
        periodStart: '2027-08-07',
        periodEnd: '2027-08-13',
        quantity: 80,
        estimatedAmount: 1600,
        unitName: 'carton',
        status: 'APPLIED',
      });
    });

    it('chaque nuit : primes de la semaine et du mois calculées, paie déjà approuvée intacte', async () => {
      const monthly = await post<IncentiveRuleDto>(
        '/incentive-rules',
        {
          name: 'Couscous du mois',
          kind: 'PER_UNIT',
          frequency: 'MONTHLY',
          productId: couscous.id,
          amount: 5,
          userId: driverId,
          validFrom: '2027-08-01',
        },
        admin,
      );
      expect(monthly.status).toBe(201);
      const automation = t.app.get(PayrollAutomationService);
      const reports = await automation.run(new Date('2027-09-01T10:00:00Z'));
      const mine = reports.find((r) => r.companyId === companyId)!;
      expect(mine).toMatchObject({ date: '2027-08-31', payrollMonths: [] });
      expect(mine.error).toBeUndefined();
      const august = (await get<IncentiveDto[]>('/incentives?periodStart=2027-08-01')).body.find(
        (i) => i.rule.id === monthly.body.id,
      );
      expect(august).toMatchObject({
        quantity: 80,
        amount: 400,
        status: 'CALCULATED',
        validatedBy: null,
      });
      const saved = await raw.incentive.findUniqueOrThrow({ where: { id: august!.id } });
      expect(saved.createdByUserId).toBeNull();
      // La prime hebdomadaire déjà appliquée ne bouge pas, la paie clôturée non plus
      expect(
        (await get<IncentiveDto[]>('/incentives?periodStart=2027-08-07')).body.filter(
          (i) => i.user.id === driverId,
        ),
      ).toHaveLength(1);
      const period = await raw.payrollPeriod.findFirstOrThrow({
        where: { companyId, month: at('2027-08-01') },
      });
      expect(period.status).toBe('CLOSED');
      await call(t.url, 'PATCH', `/incentive-rules/${monthly.body.id}`, {
        token: admin,
        body: {
          name: 'Couscous du mois',
          kind: 'PER_UNIT',
          frequency: 'MONTHLY',
          productId: couscous.id,
          amount: 5,
          userId: driverId,
          validFrom: '2027-08-01',
          isActive: false,
        },
      });
    });

    it('le brouillon de paie du mois est créé et recalculé par le système, sans doublon', async () => {
      const automation = t.app.get(PayrollAutomationService);
      const first = (await automation.run(new Date('2027-10-02T10:00:00Z'))).find(
        (r) => r.companyId === companyId,
      )!;
      expect(first).toMatchObject({ date: '2027-10-01', payrollMonths: ['2027-10'] });
      await automation.run(new Date('2027-10-02T12:00:00Z'));
      const periods = await raw.payrollPeriod.findMany({
        where: { companyId, month: at('2027-10-01') },
      });
      expect(periods).toHaveLength(1);
      expect(periods[0]).toMatchObject({ status: 'CALCULATED', calculatedByUserId: null });
      const dto = (await get<PayrollPeriodDto>(`/payroll/periods/${periods[0]!.id}`)).body;
      expect(dto.entries.find((e) => e.user.id === driverId)).toMatchObject({
        baseSalary: 60_000,
        net: 60_000,
      });
      // Validation et approbation restent humaines
      const audit = await raw.auditLog.findFirst({
        where: {
          companyId,
          action: 'payroll.calculate',
          actorUserId: null,
          entityId: periods[0]!.id,
        },
      });
      expect(audit).not.toBeNull();
      const monthly = await raw.incentive.findFirstOrThrow({
        where: { companyId, periodStart: at('2027-08-01'), userId: driverId },
      });
      expect(monthly.status).toBe('CALCULATED');
    });
  });

  describe('accès', () => {
    it("l'employé ne voit que sa propre paie", async () => {
      const mine = await call<MyPayDto>(t.url, 'GET', `/me/pay?month=${MONTH}`, {
        token: driver.token,
      });
      expect(mine.status).toBe(200);
      expect(mine.body.entry).toMatchObject({ net: 49_600, status: 'CLOSED' });
      expect(mine.body.compensation[0]).toMatchObject({ baseSalary: 60_000 });
      expect(mine.body.incentives.map((i) => i.amount)).toContain(1600);
      expect((await get('/payroll/periods', driver.token)).status).toBe(403);
      expect((await get(`/compensations?userId=${driverId}`, driver.token)).status).toBe(403);
      const v07 = await phones.get('V07');
      const other = await call<MyPayDto>(t.url, 'GET', `/me/pay?month=${MONTH}`, {
        token: v07.token,
      });
      expect(other.body.entry).toBeNull();
      expect(other.body.compensation).toEqual([]);
    });

    it('une autre entreprise ne voit ni la paie, ni les salaires, ni les écarts', async () => {
      const otherAccountant = await webLogin(t.url, 'CASHVAN-EST', 'B-CPT');
      const periods = await get<PayrollPeriodDto[]>('/payroll/periods', otherAccountant);
      expect(periods.body.find((p) => p.month === MONTH)).toBeUndefined();
      const period = await raw.payrollPeriod.findFirstOrThrow({
        where: { companyId, month: at(`${MONTH}-01`) },
      });
      expect((await get(`/payroll/periods/${period.id}`, otherAccountant)).status).toBe(404);
      expect(
        (await get<CompensationDto[]>(`/compensations?userId=${driverId}`, otherAccountant)).body,
      ).toEqual([]);
      expect(
        (await get<DiscrepancyDto[]>(`/discrepancies?userId=${driverId}`, otherAccountant)).body,
      ).toEqual([]);
      const advance = await raw.salaryAdvance.findFirstOrThrow({ where: { companyId } });
      expect((await post(`/advances/${advance.id}/approve`, {}, otherAccountant)).status).toBe(404);
    });
  });
});
