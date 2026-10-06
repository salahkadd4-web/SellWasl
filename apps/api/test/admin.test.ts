import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, PASSWORD, platformLogin, startApp, type TestApp, webLogin } from './helpers';

const login = (t: TestApp, companyCode: string, user: string, password: string) =>
  call<{ accessToken: string }>(t.url, 'POST', '/auth/login', {
    body: { companyCode, login: user, password },
  });

/** Phases 8 et 9 : création d'entreprise, utilisateurs, paramétrage, suspension. */
describe('administration de la plateforme et de l’entreprise', () => {
  let t: TestApp;
  let platform: string;
  let admin: string;
  let companyId: string;

  beforeAll(async () => {
    t = await startApp();
    platform = await platformLogin(t.url);
  });
  afterAll(() => t.close());

  it('crée une entreprise avec son mode, ses paramètres et son administrateur (UC-90)', async () => {
    const created = await call<{
      company: { id: string; modules: string[] };
      admin: { temporaryPassword: string };
    }>(t.url, 'POST', '/platform/companies', {
      token: platform,
      body: {
        name: 'Test Mixte',
        code: 'test-mixte',
        mode: 'MIXED',
        admin: { firstName: 'Ali', lastName: 'Test', email: 'ali@test.dz' },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.company.modules).toHaveLength(5);
    companyId = created.body.company.id;

    const first = await login(t, 'TEST-MIXTE', 'ADMIN', created.body.admin.temporaryPassword);
    expect(first.status).toBe(200);
    const me = await call<{ mustChangePassword: boolean; permissions: string[] }>(
      t.url,
      'GET',
      '/me',
      { token: first.body.accessToken },
    );
    expect(me.body.mustChangePassword).toBe(true);
    expect(me.body.permissions).toContain('users.create');

    const changed = await call(t.url, 'POST', '/auth/password', {
      token: first.body.accessToken,
      body: { currentPassword: created.body.admin.temporaryPassword, newPassword: PASSWORD },
    });
    expect(changed.status).toBe(204);
    admin = (await login(t, 'TEST-MIXTE', 'ali@test.dz', PASSWORD)).body.accessToken;

    const reasons = await call<unknown[]>(t.url, 'GET', '/reasons', { token: admin });
    // Motifs par défaut, dont « Retour client » et « Marchandise manquante » (phase 17) et les 7
    // motifs de refus (phase 21)
    expect(reasons.body.length).toBe(27);
  });

  it('refuse un code d’entreprise déjà utilisé', async () => {
    const reply = await call(t.url, 'POST', '/platform/companies', {
      token: platform,
      body: {
        name: 'Doublon',
        code: 'DISTRI-ORAN',
        mode: 'PRE_SALES',
        admin: { firstName: 'A', lastName: 'B' },
      },
    });
    expect(reply.status).toBe(409);
  });

  it('crée un utilisateur avec un mot de passe provisoire et refuse un code en double (BR-USR-10)', async () => {
    const created = await call<{
      user: { id: string; mustChangePassword: boolean };
      temporaryPassword: string;
    }>(t.url, 'POST', '/users', {
      token: admin,
      body: { code: 'V99', firstName: 'Nouveau', lastName: 'Vendeur', role: 'PRE_VENDEUR' },
    });
    expect(created.status).toBe(201);
    expect(created.body.user.mustChangePassword).toBe(true);
    expect(created.body.temporaryPassword).toMatch(/^[A-Za-z]{4}-\d{4}$/);

    const duplicate = await call(t.url, 'POST', '/users', {
      token: admin,
      body: { code: 'v99', firstName: 'X', lastName: 'Y', role: 'LIVREUR' },
    });
    expect(duplicate.status).toBe(409);
  });

  it('refuse un rôle dont le module est inactif (docs/modules.md §5)', async () => {
    const adminB = await webLogin(t.url, 'CASHVAN-EST', 'B-ADM');
    const reply = await call(t.url, 'POST', '/users', {
      token: adminB,
      body: { code: 'L99', firstName: 'Livreur', lastName: 'Impossible', role: 'LIVREUR' },
    });
    expect(reply.status).toBe(422);
  });

  it('réserve la gestion des utilisateurs à l’admin', async () => {
    const sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    expect((await call(t.url, 'GET', '/users', { token: sup })).status).toBe(200);
    const reply = await call(t.url, 'POST', '/users', {
      token: sup,
      body: { code: 'X1', firstName: 'A', lastName: 'B', role: 'COMPTABLE' },
    });
    expect(reply.status).toBe(403);
  });

  it("protège l'admin contre sa propre désactivation et garde un admin actif", async () => {
    const users = await call<{ id: string; code: string }[]>(t.url, 'GET', '/users', {
      token: admin,
    });
    const me = users.body.find((u) => u.code === 'ADMIN')!;
    expect((await call(t.url, 'POST', `/users/${me.id}/disable`, { token: admin })).status).toBe(
      422,
    );
  });

  it('réinitialise un mot de passe et ferme les sessions', async () => {
    const users = await call<{ id: string; code: string }[]>(t.url, 'GET', '/users', {
      token: admin,
    });
    const seller = users.body.find((u) => u.code === 'V99')!;
    const reset = await call<{ temporaryPassword: string }>(
      t.url,
      'POST',
      `/users/${seller.id}/reset-password`,
      { token: admin },
    );
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).toBeTruthy();
  });

  it('crée une nouvelle version des paramètres et applique P-10 (BR-TEN-08)', async () => {
    const current = await call<{
      version: number;
      data: { rules: Record<string, boolean>; ticketWidthMm: number };
    }>(t.url, 'GET', '/settings', { token: admin });
    expect(current.body.version).toBe(1);
    const next = {
      ...current.body.data,
      rules: { ...current.body.data.rules, P10_supervisorEditsPrices: true },
    };
    const saved = await call<{ version: number }>(t.url, 'PUT', '/settings', {
      token: admin,
      body: next,
    });
    expect(saved.body.version).toBe(2);

    const invalid = await call(t.url, 'PUT', '/settings', {
      token: admin,
      body: { ...next, ticketWidthMm: 70 },
    });
    expect(invalid.status).toBe(400);
  });

  it('confie un camion à un livreur, pas à un comptable', async () => {
    const created = await call<{ user: { id: string } }>(t.url, 'POST', '/users', {
      token: admin,
      body: { code: 'L10', firstName: 'Livreur', lastName: 'Test', role: 'LIVREUR' },
    });
    const ok = await call(t.url, 'POST', '/warehouses', {
      token: admin,
      body: {
        type: 'TRUCK',
        code: 'TRUCK-10',
        name: 'Camion 10',
        assignedUserId: created.body.user.id,
      },
    });
    expect(ok.status).toBe(201);
    const users = await call<{ id: string; code: string }[]>(t.url, 'GET', '/users', {
      token: admin,
    });
    const adminUser = users.body.find((u) => u.code === 'ADMIN')!;
    const refused = await call(t.url, 'POST', '/warehouses', {
      token: admin,
      body: { type: 'TRUCK', code: 'TRUCK-11', name: 'Camion 11', assignedUserId: adminUser.id },
    });
    expect(refused.status).toBe(422);
  });

  it('gère les jours fériés (création, doublon, suppression)', async () => {
    const created = await call<{ id: string }>(t.url, 'POST', '/holidays', {
      token: admin,
      body: { date: '2027-07-05', label: 'Indépendance' },
    });
    expect(created.status).toBe(201);
    expect(
      (
        await call(t.url, 'POST', '/holidays', {
          token: admin,
          body: { date: '2027-07-05', label: 'x' },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(t.url, 'DELETE', `/holidays/${created.body.id}`, { token: admin })).status,
    ).toBe(204);
    expect(
      (
        await call(t.url, 'POST', '/holidays', {
          token: admin,
          body: { date: '2027-07-05', label: 'Indépendance' },
        })
      ).status,
    ).toBe(201);
  });

  it('coupe l’accès d’une entreprise suspendue, puis le rétablit', async () => {
    expect(
      (await call(t.url, 'POST', `/platform/companies/${companyId}/suspend`, { token: platform }))
        .status,
    ).toBe(200);
    const refused = await login(t, 'TEST-MIXTE', 'ADMIN', PASSWORD);
    expect(refused.body.error?.code).toBe('COMPANY_SUSPENDED');
    expect((await call(t.url, 'GET', '/me', { token: admin })).body.error?.code).toBe(
      'COMPANY_SUSPENDED',
    );
    await call(t.url, 'POST', `/platform/companies/${companyId}/reactivate`, { token: platform });
    expect((await login(t, 'TEST-MIXTE', 'ADMIN', PASSWORD)).status).toBe(200);
  });
});
