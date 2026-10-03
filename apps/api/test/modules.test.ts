import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequirePermission } from '../src/common/auth-context';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, platformLogin, startApp, type TestApp, webLogin } from './helpers';

/** Route de test qui exige une permission du module PRE_SALES. */
@Controller('test/pre-sales')
class PreSalesProbeController {
  @RequirePermission('pending_lines.process')
  @Get()
  probe() {
    return { ok: true };
  }
}

/** Phase 7 : un module inactif est refusé par l'API ; le changement de mode est contrôlé. */
describe('modules et changement de mode', () => {
  let t: TestApp;
  let raw: PrismaService;
  let platform: string;
  let companyA: string;

  beforeAll(async () => {
    t = await startApp([PreSalesProbeController]);
    raw = t.app.get(PrismaService);
    platform = await platformLogin(t.url);
    companyA = (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
  });
  afterAll(() => t.close());

  it('refuse un module inactif même si le rôle a la permission (BR-TEN-04)', async () => {
    const supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    expect((await call(t.url, 'GET', '/test/pre-sales', { token: supA })).status).toBe(200);
    const supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    const reply = await call(t.url, 'GET', '/test/pre-sales', { token: supB });
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe('MODULE_DISABLED');
  });

  it('refuse le retrait d’un module tant qu’une journée est en cours (docs/modules.md §8)', async () => {
    const seller = await raw.user.findFirstOrThrow({ where: { companyId: companyA, code: 'V07' } });
    const workdayId = uuidv7();
    await raw.workday.create({
      data: {
        id: workdayId,
        companyId: companyA,
        userId: seller.id,
        date: new Date('2026-10-03'),
        status: 'IN_PROGRESS',
        settingsVersion: 1,
      },
    });
    const blocked = await call<unknown>(t.url, 'POST', `/platform/companies/${companyA}/mode`, {
      token: platform,
      body: { mode: 'CASH_VAN' },
    });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toContain('journées de pré-vendeurs en cours');
    await raw.workday.delete({ where: { id: workdayId } });
  });

  it('change de mode, coupe les fonctions retirées, puis revient', async () => {
    const toCashVan = await call<{ modules: string[] }>(
      t.url,
      'POST',
      `/platform/companies/${companyA}/mode`,
      {
        token: platform,
        body: { mode: 'CASH_VAN' },
      },
    );
    expect(toCashVan.status).toBe(200);
    expect(toCashVan.body.modules).toEqual(['CASH_VAN', 'WAREHOUSE', 'ANALYTICS']);

    const supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    expect((await call(t.url, 'GET', '/test/pre-sales', { token: supA })).body.error?.code).toBe(
      'MODULE_DISABLED',
    );
    expect((await call(t.url, 'GET', '/devices', { token: supA })).status).toBe(200); // socle : toujours actif

    const back = await call(t.url, 'POST', `/platform/companies/${companyA}/mode`, {
      token: platform,
      body: { mode: 'PRE_SALES' },
    });
    expect(back.status).toBe(200);
    expect((await call(t.url, 'GET', '/test/pre-sales', { token: supA })).status).toBe(200);
    expect(
      await raw.auditLog.count({ where: { companyId: companyA, action: 'company.mode.change' } }),
    ).toBe(2);
  });
});
