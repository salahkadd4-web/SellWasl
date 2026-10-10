import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieOptions } from '../src/auth/cookies';
import { validateEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

const DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
const SECRET = 'x'.repeat(40);
const KEY = randomBytes(32).toString('base64');

/** Sécurité (phase 27, docs/security.md). */
describe('sécurité (phase 27)', () => {
  describe('IP réelle derrière le proxy', () => {
    /** Connexion avec un X-Forwarded-For choisi ; renvoie l'IP enregistrée dans l'audit. */
    async function loginIp(trustProxy: string | undefined): Promise<string | null> {
      const previous = process.env.TRUST_PROXY;
      if (trustProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = trustProxy;
      const t: TestApp = await startApp();
      try {
        const reply = await fetch(`${t.url}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
          body: JSON.stringify({
            companyCode: 'DISTRI-ORAN',
            login: 'A-CPT',
            password: 'SellWasl@2026',
          }),
        });
        expect(reply.status).toBe(200);
        const row = await t.app.get(PrismaService).auditLog.findFirstOrThrow({
          where: { action: 'auth.login', actorUser: { code: 'A-CPT' } },
          orderBy: { createdAt: 'desc' },
        });
        return row.ip;
      } finally {
        await t.close();
        if (previous === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = previous;
      }
    }

    it('sans proxy de confiance, X-Forwarded-For est ignoré', async () => {
      expect(await loginIp(undefined)).not.toBe('203.0.113.7');
      expect(await loginIp('0')).not.toBe('203.0.113.7');
    });

    it('avec TRUST_PROXY=1, l’IP du client vient du proxy', async () => {
      expect(await loginIp('1')).toBe('203.0.113.7');
    });
  });

  describe('configuration', () => {
    const base = { DATABASE_URL };

    it('en production, refuse de démarrer sans secret ou avec le secret de développement', () => {
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'production', DATA_ENCRYPTION_KEY: KEY }),
      ).toThrow(/JWT_ACCESS_SECRET/);
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: 'dev-only-secret-change-me-in-production-0123456789',
          DATA_ENCRYPTION_KEY: KEY,
        }),
      ).toThrow(/JWT_ACCESS_SECRET/);
      expect(() =>
        validateEnv({ ...base, NODE_ENV: 'staging', JWT_ACCESS_SECRET: SECRET }),
      ).toThrow(/DATA_ENCRYPTION_KEY/);
      expect(() =>
        validateEnv({
          ...base,
          NODE_ENV: 'production',
          JWT_ACCESS_SECRET: SECRET,
          DATA_ENCRYPTION_KEY: 'trop-court',
        }),
      ).toThrow(/DATA_ENCRYPTION_KEY/);
      const env = validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: SECRET,
        DATA_ENCRYPTION_KEY: KEY,
        TRUST_PROXY: '1',
      });
      expect(env.TRUST_PROXY).toBe(1);
    });

    it('en développement, des valeurs par défaut suffisent', () => {
      const env = validateEnv({ ...base, NODE_ENV: 'development' });
      expect(env.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
      expect(env.TRUST_PROXY).toBe(0);
    });

    it('cookie de rafraîchissement Secure hors développement et test', () => {
      expect(cookieOptions('/x', 'production').secure).toBe(true);
      expect(cookieOptions('/x', 'staging').secure).toBe(true);
      expect(cookieOptions('/x', 'development').secure).toBe(false);
      expect(cookieOptions('/x', 'test').secure).toBe(false);
    });
  });
});

/** Suite partagée pour les tâches suivantes (une seule application). */
describe('sécurité : comptes', () => {
  let t: TestApp;
  let adm: string;
  let raw: PrismaService;
  const previous = process.env.TRUST_PROXY;
  let ip = 0;

  // Attaquant qui change d'IP à chaque essai : la limite par IP ne l'arrête pas, le blocage du
  // compte si (et le test n'est pas freiné par la limite de 10 connexions par minute)
  beforeAll(async () => {
    process.env.TRUST_PROXY = '1';
    t = await startApp();
    adm = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    raw = t.app.get(PrismaService);
  });
  afterAll(async () => {
    await t.close();
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });

  /** Compte Web créé pour le test, avec son mot de passe provisoire. */
  async function newUser(prefix: string) {
    const created = await call<{ user: { id: string; code: string }; temporaryPassword: string }>(
      t.url,
      'POST',
      '/users',
      {
        token: adm,
        body: {
          code: `${prefix}${Date.now() % 100000}`,
          firstName: 'Test',
          lastName: 'Sécurité',
          role: 'COMPTABLE',
        },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return { ...created.body.user, password: created.body.temporaryPassword };
  }
  const login = async (code: string, password: string) => {
    ip += 1;
    const reply = await fetch(`${t.url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${ip}` },
      body: JSON.stringify({ companyCode: 'DISTRI-ORAN', login: code, password }),
    });
    return {
      status: reply.status,
      body: (await reply.json()) as {
        accessToken: string;
        error?: { code: string; details?: { until?: string } };
      },
    };
  };

  it('5 échecs : compte bloqué 15 minutes, même avec le bon mot de passe', async () => {
    const u = await newUser('LCK');
    for (let i = 0; i < 4; i += 1) expect((await login(u.code, 'Mauvais123')).status).toBe(401);
    // Une connexion réussie remet le compteur à zéro
    expect((await login(u.code, u.password)).status).toBe(200);
    for (let i = 0; i < 5; i += 1) expect((await login(u.code, 'Mauvais123')).status).toBe(401);
    const locked = await login(u.code, u.password);
    expect(locked.status).toBe(403);
    expect(locked.body.error?.code).toBe('ACCOUNT_LOCKED');
    const until = new Date(locked.body.error!.details!.until!).getTime();
    expect(until - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(await raw.auditLog.count({ where: { action: 'auth.lockout', entityId: u.id } })).toBe(1);
    // Fin du blocage : connexion possible
    await raw.user.update({
      where: { id: u.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    expect((await login(u.code, u.password)).status).toBe(200);
  });

  it('la réinitialisation du mot de passe par l’admin débloque le compte', async () => {
    const u = await newUser('RST');
    for (let i = 0; i < 5; i += 1) await login(u.code, 'Mauvais123');
    expect((await login(u.code, u.password)).status).toBe(403);
    const reset = await call<{ temporaryPassword: string }>(
      t.url,
      'POST',
      `/users/${u.id}/reset-password`,
      { token: adm },
    );
    expect((await login(u.code, reset.body.temporaryPassword)).status).toBe(200);
  });

  it('nouveau mot de passe : lettre, chiffre, différent de l’ancien, sans l’identifiant', async () => {
    const u = await newUser('PWD');
    const token = (await login(u.code, u.password)).body.accessToken;
    const change = (newPassword: string) =>
      call<{ error?: { code: string } }>(t.url, 'POST', '/auth/password', {
        token,
        body: { currentPassword: u.password, newPassword },
      });
    expect((await change('abcdefgh')).status).toBe(400);
    expect((await change('12345678')).status).toBe(400);
    expect((await change('Ab1')).status).toBe(400);
    expect((await change(`x1${u.code.toLowerCase()}`)).status).toBe(400);
    expect((await change(u.password)).status).toBe(400);
    expect((await change('Solide2026')).status).toBe(204);
  });
});

/** Suite partagée pour les tâches suivantes (une seule application). */
describe('sécurité : application', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());

  it('démarre', async () => {
    expect(await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP')).toBeTruthy();
  });
});
