import { PERMISSIONS } from '@sellwasl/business-rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown>; requestId?: string };
}

/** Contrat de l'API (docs/api.md §1-2, phase 25). */
describe('contrat de l’API (phase 25)', () => {
  let t: TestApp;
  let sup: string;

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
  });
  afterAll(async () => {
    // Client de test retiré : d'autres suites comptent les clients à revoir
    await t.app
      .get(PrismaService)
      .customer.updateMany({
        where: { name: 'Client en double' },
        data: { deletedAt: new Date() },
      });
    await t.close();
  });

  /** Même forme pour toutes les erreurs : code, message en français, requestId. */
  const shaped = (body: unknown, code: string) => {
    const e = (body as ErrorBody).error;
    expect(e.code).toBe(code);
    expect(typeof e.message).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.requestId).toBeTruthy();
    return e;
  };

  describe('erreurs homogènes (§2)', () => {
    it('400 : champs invalides détaillés', async () => {
      const reply = await call(t.url, 'POST', '/customers', { token: sup, body: { name: '' } });
      expect(reply.status).toBe(400);
      const e = shaped(reply.body, 'VALIDATION_ERROR');
      expect((e.details as { fields: unknown[] }).fields.length).toBeGreaterThan(0);
    });

    it('401 : sans session', async () => {
      const reply = await call(t.url, 'GET', '/customers');
      expect(reply.status).toBe(401);
      shaped(reply.body, 'UNAUTHENTICATED');
    });

    it('403 : droit manquant', async () => {
      const phones = new Phones(t, { 'DISTRI-ORAN': sup });
      const p = await phones.get('V07');
      const reply = await call(t.url, 'GET', '/users', { token: p.token });
      expect(reply.status).toBe(403);
      expect((reply.body as ErrorBody).error.requestId).toBeTruthy();
    });

    it('404 : ressource inexistante et route inconnue', async () => {
      const missing = await call(t.url, 'GET', `/customers/${uuidv7()}`, { token: sup });
      expect(missing.status).toBe(404);
      shaped(missing.body, 'NOT_FOUND');
      const unknown = await call(t.url, 'GET', '/route-qui-n-existe-pas', { token: sup });
      expect(unknown.status).toBe(404);
      shaped(unknown.body, 'NOT_FOUND');
    });

    it('409 : doublon', async () => {
      const type = await call<{ id: string }[]>(t.url, 'GET', '/customer-types', { token: sup });
      const body = {
        code: `DUP-${Date.now()}`,
        name: 'Client en double',
        customerTypeId: type.body[0]!.id,
        // Loin de toute partie : client hors partie, sans ambiguïté
        latitude: 30,
        longitude: 5,
        frequency: 'WEEKLY',
      };
      const first = await call(t.url, 'POST', '/customers', { token: sup, body });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const again = await call(t.url, 'POST', '/customers', { token: sup, body });
      expect(again.status).toBe(409);
      shaped(again.body, 'DUPLICATE');
    });

    it('422 : règle métier', async () => {
      const reply = await call(t.url, 'PUT', '/quotas', {
        token: sup,
        body: {
          date: '2020-01-01',
          entries: [{ userId: uuidv7(), productVariantId: uuidv7(), unitId: uuidv7(), qty: 1 }],
        },
      });
      expect(reply.status).toBe(422);
      shaped(reply.body, 'BUSINESS_RULE');
    });

    it('429 : trop de tentatives de connexion', async () => {
      let last = 0;
      let body: unknown = null;
      for (let i = 0; i < 12; i += 1) {
        const reply = await call(t.url, 'POST', '/auth/login', {
          body: { companyCode: 'DISTRI-ORAN', login: 'A-SUP', password: 'mauvais' },
        });
        last = reply.status;
        body = reply.body;
      }
      expect(last).toBe(429);
      shaped(body, 'RATE_LIMITED');
    });
  });

  it('chaque droit du catalogue appartient à un module', () => {
    for (const p of PERMISSIONS) expect(p.module, p.code).toBeTruthy();
  });
});
