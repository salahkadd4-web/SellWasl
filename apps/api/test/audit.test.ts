import type { AuditRowDto, Page } from '@sellwasl/validation';
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

  describe('consultation (admin)', () => {
    const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Algiers' });
    const list = (query: string, token = adm) =>
      call<Page<AuditRowDto>>(t.url, 'GET', `/audit${query}`, { token });

    it('l’admin lit le journal par pages, avec les libellés', async () => {
      const reply = await list('?limit=5');
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      expect(reply.body.data.length).toBe(5);
      expect(reply.body.total).toBeGreaterThan(5);
      expect(reply.body.nextCursor).toBeTruthy();
      const at = reply.body.data.map((r) => r.at);
      expect(at).toEqual([...at].sort().reverse());
      const login = (await list('?action=auth.login&limit=1')).body.data[0]!;
      expect(login).toMatchObject({
        actionLabel: 'Connexion',
        entity: 'User',
        entityLabel: 'Utilisateur',
      });
      expect(login.actor?.name).toBeTruthy();
    });

    it('autre rôle : 403 ; autre entreprise : rien de cette entreprise', async () => {
      expect((await list('', sup)).status).toBe(403);
      const reasons = await raw.auditLog.findFirstOrThrow({
        where: { companyId, action: 'reason.update' },
      });
      const other = await webLogin(t.url, 'CASHVAN-EST', 'B-ADM');
      const reply = await list(`?entityId=${reasons.entityId}`, other);
      expect(reply.status).toBe(200);
      expect(reply.body.total).toBe(0);
    });

    it('filtres : action, fiche, auteur et période', async () => {
      const admin = await raw.user.findFirstOrThrow({ where: { companyId, code: 'A-ADM' } });
      const byAction = await list('?action=reason.update&entity=Reason&limit=200');
      expect(byAction.body.total).toBeGreaterThan(0);
      expect(
        byAction.body.data.every((r) => r.action === 'reason.update' && r.entity === 'Reason'),
      ).toBe(true);
      const byUser = await list(`?userId=${admin.id}&limit=200`);
      expect(byUser.body.data.every((r) => r.actor?.id === admin.id)).toBe(true);
      const day = today();
      const recent = await list(`?from=${day}&to=${day}&action=reason.update`);
      expect(recent.body.total).toBeGreaterThan(0);
      const past = await list('?from=2020-01-01&to=2020-01-31');
      expect(past.body.total).toBe(0);
      expect((await list('?action=inconnue')).status).toBe(400);
    });

    it('export CSV : mêmes filtres, formule neutralisée', async () => {
      // Auteur dont le prénom ressemble à une formule : la cellule commence par une apostrophe
      const created = await call<{ user: { id: string; code: string }; temporaryPassword: string }>(
        t.url,
        'POST',
        '/users',
        {
          token: adm,
          body: {
            code: `FRM${Date.now() % 100000}`,
            firstName: '=SOMME(A1)',
            lastName: 'Test',
            role: 'COMPTABLE',
          },
        },
      );
      expect(created.status).toBe(201);
      const login = await call(t.url, 'POST', '/auth/login', {
        body: {
          companyCode: 'DISTRI-ORAN',
          login: created.body.user.code,
          password: created.body.temporaryPassword,
        },
      });
      expect(login.status).toBe(200);
      const reply = await fetch(
        `${t.url}/audit/export?userId=${created.body.user.id}&action=auth.login`,
        { headers: { Authorization: `Bearer ${adm}` } },
      );
      expect(reply.status).toBe(200);
      expect(reply.headers.get('content-type')).toContain('text/csv');
      const csv = await reply.text();
      const lines = csv.trim().split('\n');
      expect(lines[0]).toContain('Action');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('Connexion');
      expect(lines[1]).toContain("'=SOMME(A1)");
      const forbidden = await fetch(`${t.url}/audit/export`, {
        headers: { Authorization: `Bearer ${sup}` },
      });
      expect(forbidden.status).toBe(403);
      await raw.user.update({ where: { id: created.body.user.id }, data: { status: 'DISABLED' } });
    });

    it('le journal ne se modifie pas et ne s’efface pas', async () => {
      const row = await raw.auditLog.findFirstOrThrow({ where: { companyId } });
      await expect(
        raw.auditLog.update({ where: { id: row.id }, data: { action: 'auth.logout' } }),
      ).rejects.toThrow();
      await expect(raw.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });
});
