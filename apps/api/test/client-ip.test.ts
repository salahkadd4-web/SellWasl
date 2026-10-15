import { WEB_PROXY_IP_HEADER, WEB_PROXY_KEY_HEADER } from '@sellwasl/business-rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PASSWORD, startApp, type TestApp } from './helpers';

const SECRET = 'cle-partagee-entre-le-web-et-l-api-0123456789';

/**
 * Adresse du client transmise par le Web (phase 30, docs/deployment.md §9) : le Web passe par
 * Vercel puis Render, le mobile par Render seul ; l'API croit l'adresse posée par le Web
 * seulement avec la clé partagée.
 */
describe('adresse du client transmise par le Web', () => {
  let t: TestApp;
  const previous = process.env.WEB_PROXY_SECRET;

  beforeAll(async () => {
    process.env.WEB_PROXY_SECRET = SECRET;
    t = await startApp();
  });
  afterAll(async () => {
    await t.close();
    if (previous === undefined) delete process.env.WEB_PROXY_SECRET;
    else process.env.WEB_PROXY_SECRET = previous;
  });

  async function seen(headers: Record<string, string>) {
    const reply = await fetch(`${t.url}/health/ip`, { headers });
    expect(reply.status).toBe(200);
    return (await reply.json()) as { ip: string | null; viaWeb: boolean };
  }

  it('clé correcte : l’adresse posée par le Web est retenue', async () => {
    expect(
      await seen({ [WEB_PROXY_IP_HEADER]: '203.0.113.20', [WEB_PROXY_KEY_HEADER]: SECRET }),
    ).toEqual({ ip: '203.0.113.20', viaWeb: true });
  });

  it('clé fausse ou absente, adresse illisible : l’en-tête est ignoré', async () => {
    for (const headers of <Record<string, string>[]>[
      { [WEB_PROXY_IP_HEADER]: '203.0.113.21', [WEB_PROXY_KEY_HEADER]: 'mauvaise-cle' },
      { [WEB_PROXY_IP_HEADER]: '203.0.113.21' },
      { [WEB_PROXY_IP_HEADER]: 'pas-une-adresse', [WEB_PROXY_KEY_HEADER]: SECRET },
    ]) {
      const result = await seen(headers);
      expect(result.viaWeb).toBe(false);
      expect(result.ip).not.toBe('203.0.113.21');
      expect(result.ip).not.toBe('pas-une-adresse');
    }
  });

  it('l’audit de connexion enregistre l’adresse posée par le Web', async () => {
    const reply = await fetch(`${t.url}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WEB_PROXY_IP_HEADER]: '203.0.113.22',
        [WEB_PROXY_KEY_HEADER]: SECRET,
      },
      body: JSON.stringify({ companyCode: 'DISTRI-ORAN', login: 'A-CPT', password: PASSWORD }),
    });
    expect(reply.status).toBe(200);
    const row = await t.app.get(PrismaService).auditLog.findFirstOrThrow({
      where: { action: 'auth.login', actorUser: { code: 'A-CPT' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.ip).toBe('203.0.113.22');
  });
});
