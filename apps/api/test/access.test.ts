import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, platformLogin, startApp, type TestApp, webLogin } from './helpers';

/** Phases 5 et 6 par l'API : isolation, permissions, canal, séparation de la plateforme. */
describe("contrôle d'accès par l'API", () => {
  let t: TestApp;
  let supA: string;
  let userOfB: string;

  beforeAll(async () => {
    t = await startApp();
    supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    const raw = t.app.get(PrismaService);
    userOfB = (
      await raw.user.findFirstOrThrow({ where: { code: 'C01', company: { code: 'CASHVAN-EST' } } })
    ).id;
  });
  afterAll(() => t.close());

  it("ne liste que les utilisateurs terrain de l'entreprise", async () => {
    const reply = await call<{ code: string }[]>(t.url, 'GET', '/devices', { token: supA });
    expect(reply.status).toBe(200);
    expect(reply.body.map((u) => u.code).sort()).toEqual(['L01', 'M01', 'V07', 'V08']);
  });

  it("répond 404 sur un utilisateur d'une autre entreprise (IDOR)", async () => {
    const reply = await call(t.url, 'POST', `/users/${userOfB}/activation-codes`, { token: supA });
    expect(reply.status).toBe(404);
  });

  it('refuse une action sans la permission du rôle', async () => {
    const comptable = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    const reply = await call(t.url, 'GET', '/devices', { token: comptable });
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe('FORBIDDEN');
  });

  it('refuse un rôle terrain sur le Web (BR-USR-02)', async () => {
    const reply = await call(t.url, 'POST', '/auth/login', {
      body: { companyCode: 'DISTRI-ORAN', login: 'V07', password: 'SellWasl@2026' },
    });
    expect(reply.body.error?.code).toBe('WRONG_CHANNEL');
  });

  it('refuse une requête sans session', async () => {
    expect((await call(t.url, 'GET', '/me')).status).toBe(401);
  });

  it("sépare les comptes plateforme et les comptes d'entreprise", async () => {
    const platform = await platformLogin(t.url);
    expect((await call(t.url, 'GET', '/me', { token: platform })).status).toBe(403);
    expect((await call(t.url, 'GET', '/platform/me', { token: supA })).status).toBe(403);
    expect((await call(t.url, 'GET', '/platform/me', { token: platform })).status).toBe(200);
  });

  it('donne à chaque utilisateur les modules de son entreprise', async () => {
    const supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    const reply = await call<{ modules: string[] }>(t.url, 'GET', '/modules', { token: supB });
    expect(reply.body.modules).toEqual(['CASH_VAN', 'WAREHOUSE', 'ANALYTICS']);
  });
});
