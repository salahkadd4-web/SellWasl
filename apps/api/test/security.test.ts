import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookieOptions } from '../src/auth/cookies';
import { validateEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { startApp, type TestApp, webLogin } from './helpers';

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
