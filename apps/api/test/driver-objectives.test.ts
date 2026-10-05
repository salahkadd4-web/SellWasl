import type { DriverObjectiveDto, DriverObjectivesSettings } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

/** Mois réservé à cette suite. */
const MONTH = '2027-04';

/** Objectifs du livreur : taux de retour et critères notés (phase 19). */
describe('objectifs du livreur (phase 19)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let driverId: string;
  const cleanliness = uuidv7();
  const punctuality = uuidv7();

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    const driver = await raw.user.findFirstOrThrow({
      where: { code: 'L01', company: { code: 'DISTRI-ORAN' } },
    });
    driverId = driver.id;
    // Un déchargement du mois : 400 chargés, 18 revenus → 4,5 % de retour
    const truck = await raw.warehouse.findFirstOrThrow({
      where: { company: { code: 'DISTRI-ORAN' }, code: 'TRUCK-01' },
    });
    const variant = await raw.productVariant.findFirstOrThrow({
      where: { reference: 'THON-TOM', company: { code: 'DISTRI-ORAN' } },
    });
    const workdayId = uuidv7();
    await raw.workday.create({
      data: {
        id: workdayId,
        companyId: driver.companyId,
        userId: driver.id,
        date: new Date(`${MONTH}-10T00:00:00Z`),
        status: 'CLOSED',
        settingsVersion: 1,
      },
    });
    await raw.unload.create({
      data: {
        id: uuidv7(),
        companyId: driver.companyId,
        date: new Date(`${MONTH}-10T00:00:00Z`),
        status: 'VALIDATED',
        truckId: truck.id,
        userId: driver.id,
        workdayId,
        unloadLines: {
          create: {
            id: uuidv7(),
            companyId: driver.companyId,
            productVariantId: variant.id,
            loadedQty: 400,
            deliveredQty: 382,
            freeQty: 0,
            theoreticalQty: 18,
            countedQty: 18,
            gapQty: 0,
          },
        },
      },
    });
  });
  afterAll(async () => {
    await t.close();
  });

  const settings = (body?: DriverObjectivesSettings) =>
    body
      ? call(t.url, 'PUT', '/driver-objectives/settings', { token: sup, body })
      : call<DriverObjectivesSettings>(t.url, 'GET', '/driver-objectives/settings', { token: sup });
  const tiers = [
    { maxRate: 5, score: 100 },
    { maxRate: 8, score: 70 },
    { maxRate: 12, score: 40 },
  ];

  it('règles par défaut : 100 % sur le taux de retour, trois paliers', async () => {
    const current = await settings();
    expect(current.body).toMatchObject({ returnWeight: 100, criteria: [] });
    expect(current.body.returnTiers).toEqual(tiers);
  });

  it('refuse des poids dont la somme ne fait pas 100', async () => {
    const refused = await settings({
      returnWeight: 60,
      returnTiers: tiers,
      criteria: [{ id: cleanliness, name: 'Propreté du camion', weight: 30 }],
    });
    expect(refused.status).toBe(400);
  });

  it('calcule le taux de retour, le score pondéré et la prime due', async () => {
    const saved = await settings({
      returnWeight: 60,
      returnTiers: tiers,
      criteria: [
        { id: cleanliness, name: 'Propreté du camion', weight: 25 },
        { id: punctuality, name: 'Ponctualité', weight: 15 },
      ],
    });
    expect(saved.status).toBe(200);
    const put = await call(t.url, 'PUT', '/driver-objectives', {
      token: sup,
      body: {
        month: MONTH,
        entries: [
          {
            userId: driverId,
            bonusAmount: 12000,
            ratings: { [cleanliness]: 8, [punctuality]: 10 },
          },
        ],
      },
    });
    expect(put.status).toBe(200);
    const list = await call<DriverObjectiveDto[]>(
      t.url,
      'GET',
      `/driver-objectives?month=${MONTH}`,
      {
        token: sup,
      },
    );
    const row = list.body.find((r) => r.user.id === driverId)!;
    // 60 × 100 (4,5 % ≤ 5 %) + 25 × 80 + 15 × 100 → 95 % ; 12 000 × 95 % = 11 400 DA
    expect(row).toMatchObject({
      loaded: 400,
      returned: 18,
      returnRate: 4.5,
      returnScore: 100,
      score: 95,
      estimatedBonus: 11400,
    });
  });

  it('un mois sans chargement : pas de taux, score du taux de retour à 0', async () => {
    const list = await call<DriverObjectiveDto[]>(
      t.url,
      'GET',
      '/driver-objectives?month=2027-05',
      {
        token: sup,
      },
    );
    expect(list.body.find((r) => r.user.id === driverId)).toMatchObject({
      returnRate: null,
      returnScore: 0,
      score: 0,
    });
  });

  it('refuse une note sur un critère inconnu ou hors 0 à 10', async () => {
    const unknown = await call(t.url, 'PUT', '/driver-objectives', {
      token: sup,
      body: {
        month: MONTH,
        entries: [{ userId: driverId, bonusAmount: 1, ratings: { [uuidv7()]: 5 } }],
      },
    });
    expect(unknown.status).toBe(422);
    const tooHigh = await call(t.url, 'PUT', '/driver-objectives', {
      token: sup,
      body: {
        month: MONTH,
        entries: [{ userId: driverId, bonusAmount: 1, ratings: { [cleanliness]: 11 } }],
      },
    });
    expect(tooHigh.status).toBe(400);
  });

  it('le livreur voit son objectif sur son téléphone', async () => {
    const phones = new Phones(t, { 'DISTRI-ORAN': sup });
    const driver = await phones.get('L01');
    const mine = await call<DriverObjectiveDto[]>(t.url, 'GET', '/me/driver-objectives', {
      token: driver.token,
    });
    expect(mine.status).toBe(200);
    expect(mine.body[0]).toMatchObject({ user: expect.objectContaining({ code: 'L01' }) });
  });
});
