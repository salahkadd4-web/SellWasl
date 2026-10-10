import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, PASSWORD, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

/** Samedi réservé à cette suite. */
const DAY = '2032-05-08';

/** Journal d'audit (BR-AUD-01, phase 26). */
describe('audit (phase 26)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let adm: string;
  let sup: string;
  let companyId: string;

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    adm = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    companyId = (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
  });
  afterAll(() => t.close());

  describe('contexte automatique', () => {
    it('une modification faite sur le Web porte l’IP et le navigateur', async () => {
      const reasons = await call<{ id: string; label: string; systemCode: string | null }[]>(
        t.url,
        'GET',
        '/reasons',
        { token: adm },
      );
      const reason = reasons.body.find((r) => !r.systemCode)!;
      const reply = await fetch(`${t.url}/reasons/${reason.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adm}`,
          'User-Agent': 'Navigateur-Audit/1.0',
        },
        body: JSON.stringify({ label: reason.label }),
      });
      expect(reply.status).toBe(200);
      const row = await raw.auditLog.findFirstOrThrow({
        where: { action: 'reason.update', entityId: reason.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.userAgent).toBe('Navigateur-Audit/1.0');
      expect(row.ip).toBeTruthy();
      expect(row.deviceId).toBeNull();
    });

    it('une opération du téléphone porte l’appareil', async () => {
      const phones = new Phones(t, { 'DISTRI-ORAN': sup });
      const p = await phones.get('V07');
      const workdayId = await phones.startDay(p, DAY);
      await phones.closeDay(p, workdayId);
      const row = await raw.auditLog.findFirstOrThrow({
        where: { action: 'workday.start', entityId: workdayId },
      });
      expect(row.deviceId).toBe(p.deviceId);
    });

    it('hors requête (tâche de nuit), le journal s’écrit sans contexte', async () => {
      await t.app.get(AuditService).write({
        companyId,
        actorUserId: null,
        action: 'incentive.calculate',
        entity: 'Incentive',
      });
      const row = await raw.auditLog.findFirstOrThrow({
        where: { companyId, action: 'incentive.calculate', actorUserId: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.ip).toBeNull();
      expect(row.deviceId).toBeNull();
    });
  });

  it('aucun mot de passe ni jeton dans le journal', async () => {
    const created = await call<{ user: { id: string }; temporaryPassword: string }>(
      t.url,
      'POST',
      '/users',
      {
        token: adm,
        body: {
          code: `AUD${Date.now() % 100000}`,
          firstName: 'Audit',
          lastName: 'Secret',
          role: 'COMPTABLE',
        },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const userId = created.body.user.id;
    const reset = await call<{ temporaryPassword: string }>(
      t.url,
      'POST',
      `/users/${userId}/reset-password`,
      { token: adm },
    );
    const temporary = reset.body.temporaryPassword;
    const user = await raw.user.findUniqueOrThrow({ where: { id: userId } });
    const login = await call<{ accessToken: string }>(t.url, 'POST', '/auth/login', {
      body: { companyCode: 'DISTRI-ORAN', login: user.code, password: temporary },
    });
    expect(login.status).toBe(200);
    const changed = await call(t.url, 'POST', '/auth/password', {
      token: login.body.accessToken,
      body: { currentPassword: temporary, newPassword: `${PASSWORD}x` },
    });
    expect(changed.status).toBe(204);

    const rows = await raw.auditLog.findMany({ where: { companyId } });
    const mine = rows.filter((r) => r.entityId === userId).map((r) => r.action);
    expect(mine).toEqual(
      expect.arrayContaining([
        'user.create',
        'user.password.reset',
        'auth.login',
        'user.password.change',
      ]),
    );
    const text = JSON.stringify(rows.map((r) => [r.before, r.after, r.reason]));
    for (const secret of [
      created.body.temporaryPassword,
      temporary,
      `${PASSWORD}x`,
      PASSWORD,
      login.body.accessToken,
    ])
      expect(text).not.toContain(secret);
    expect(text).not.toMatch(/passwordHash|refreshToken|tokenHash|"token"/i);
    await raw.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
  });
});
