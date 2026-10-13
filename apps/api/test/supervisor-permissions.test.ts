import type { SupervisorPermissionsDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { RolesService } from '../src/roles/roles.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Permissions du superviseur réglées par l'administrateur (docs/rbac.md §7 bis). */
describe('permissions du superviseur', () => {
  let t: TestApp;
  let raw: PrismaService;
  let admin: string;
  let sup: string;
  let initial: string[];
  const path = '/roles/supervisor/permissions';
  const get = (token: string) => call<SupervisorPermissionsDto>(t.url, 'GET', path, { token });
  const put = (token: string, permissions: string[]) =>
    call<SupervisorPermissionsDto>(t.url, 'PUT', path, { token, body: { permissions } });

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    initial = (await get(admin)).body.granted;
  });
  afterAll(async () => {
    // Données de démonstration rétablies pour les autres suites
    await put(admin, initial);
    await t.close();
  });

  it("l'administrateur seul règle les permissions ; liste des permissions déléguables", async () => {
    expect((await get(sup)).status).toBe(403);
    expect((await put(sup, initial)).status).toBe(403);
    const reply = await get(admin);
    expect(reply.status).toBe(200);
    const codes = reply.body.delegable.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['users.create', 'audit.read']));
    expect(codes).not.toContain('roles.manage');
    expect(reply.body.delegable.find((p) => p.code === 'audit.read')?.description).toBeTruthy();
    expect(reply.body.granted).toEqual(expect.arrayContaining(reply.body.defaults));
  });

  it('accorder le journal d’audit : effet dès la requête suivante, écrit dans le journal', async () => {
    expect((await call(t.url, 'GET', '/audit', { token: sup })).status).toBe(403);
    const reply = await put(admin, [...initial, 'audit.read']);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.granted).toContain('audit.read');
    expect((await call(t.url, 'GET', '/audit', { token: sup })).status).toBe(200);
    const role = await raw.role.findFirstOrThrow({
      where: { code: 'SUPERVISEUR', company: { code: 'DISTRI-ORAN' } },
    });
    const log = await raw.auditLog.findFirst({
      where: { action: 'role.permissions.update', entityId: role.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.after).toMatchObject({ permissions: expect.arrayContaining(['audit.read']) });
    // Retirée : de nouveau refusé
    await put(admin, initial);
    expect((await call(t.url, 'GET', '/audit', { token: sup })).status).toBe(403);
  });

  it('interdits absolus et gestion des permissions : refusés, rien n’est changé', async () => {
    for (const forbidden of ['orders.own', 'payments.collect_debt', 'roles.manage', 'inconnue']) {
      const reply = await put(admin, [...initial, forbidden]);
      expect(reply.status, forbidden).toBe(422);
    }
    expect((await get(admin)).body.granted).toEqual(initial);
  });

  it('P-10 changé : les autres permissions réglées par l’administrateur restent', async () => {
    await put(admin, [...initial, 'audit.read']);
    const roles = t.app.get(RolesService);
    const company = await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    await raw.$transaction((tx) =>
      roles.applySettingPermissions(tx, company.id, {
        P08_driverCollectsOldDebts: true,
        P10_supervisorEditsPrices: true,
      }),
    );
    let granted = (await get(admin)).body.granted;
    expect(granted).toEqual(expect.arrayContaining(['audit.read', 'prices.update']));
    await raw.$transaction((tx) =>
      roles.applySettingPermissions(tx, company.id, {
        P08_driverCollectsOldDebts: true,
        P10_supervisorEditsPrices: false,
      }),
    );
    granted = (await get(admin)).body.granted;
    expect(granted).toContain('audit.read');
    expect(granted).not.toContain('prices.update');
  });
});
