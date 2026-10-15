import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { DevicePingPurgeService } from '../src/devices/device-ping-purge.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { startApp, type TestApp } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

/** Positions conservées 90 jours (BR-JOU-09) : purge de nuit, toutes entreprises. */
describe('purge des positions', () => {
  let t: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    t = await startApp();
    prisma = t.app.get(PrismaService);
  });
  afterAll(() => t.close());

  /** Une position datée de `daysAgo` jours avant `now`, sur un appareil de l'entreprise. */
  async function ping(companyCode: string, now: Date, daysAgo: number): Promise<string> {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: companyCode } });
    const user = await prisma.user.findFirstOrThrow({ where: { companyId: company.id } });
    // Comme dans la suite complète : l'utilisateur a déjà un appareil actif (un seul permis)
    await prisma.device
      .upsert({
        where: {
          companyId_userId_series: {
            companyId: company.id,
            userId: user.id,
            series: 'PURGE-ACTIF',
          },
        },
        update: {},
        create: {
          id: uuidv7(),
          series: 'PURGE-ACTIF',
          activatedAt: now,
          companyId: company.id,
          userId: user.id,
        },
      })
      .catch(() => undefined); // un autre appareil actif existe déjà : c'est le cas visé
    const device = await prisma.device.upsert({
      where: {
        companyId_userId_series: { companyId: company.id, userId: user.id, series: 'PURGE-TEST' },
      },
      update: {},
      create: {
        id: uuidv7(),
        series: 'PURGE-TEST',
        // Révoqué : il porte les positions sans occuper la place de l'appareil actif
        status: 'REVOKED',
        activatedAt: now,
        companyId: company.id,
        userId: user.id,
      },
    });
    const id = uuidv7();
    await prisma.devicePing.create({
      data: {
        id,
        recordedAt: new Date(now.getTime() - daysAgo * DAY),
        companyId: company.id,
        userId: user.id,
        deviceId: device.id,
      },
    });
    return id;
  }

  it('supprime les positions de plus de 90 jours, dans toutes les entreprises', async () => {
    const now = new Date('2027-03-01T02:45:00Z');
    const oldOran = await ping('DISTRI-ORAN', now, 91);
    const oldEst = await ping('CASHVAN-EST', now, 120);
    const keptOran = await ping('DISTRI-ORAN', now, 89);
    const keptEst = await ping('CASHVAN-EST', now, 1);

    const purged = await t.app.get(DevicePingPurgeService).run(now);

    expect(purged).toBeGreaterThanOrEqual(2);
    const left = await prisma.devicePing.findMany({
      where: { id: { in: [oldOran, oldEst, keptOran, keptEst] } },
      select: { id: true },
    });
    expect(left.map((p) => p.id).sort()).toEqual([keptOran, keptEst].sort());
  });
});
