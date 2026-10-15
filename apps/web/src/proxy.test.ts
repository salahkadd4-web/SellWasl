// @vitest-environment node
import { WEB_PROXY_IP_HEADER, WEB_PROXY_KEY_HEADER } from '@sellwasl/business-rules';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'cle-partagee-entre-le-web-et-l-api-0123456789';

/** Proxy chargé avec l'environnement voulu : il le lit au démarrage. */
async function loadProxy(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return (await import('./proxy')).proxy;
}

/** En-tête transmis à la destination (l'API) : Next.js le note sur la réponse du proxy. */
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

/** Adresse du client vers l'API (phase 30, docs/deployment.md §9). */
describe('proxy du Web : requêtes vers l’API', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('pose l’adresse du client et la clé, en écrasant celles envoyées par le visiteur', async () => {
    const proxy = await loadProxy({ TRUST_PROXY: '1', WEB_PROXY_SECRET: SECRET });
    const request = new NextRequest('https://sellwasl.example/api/v1/auth/login', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        [WEB_PROXY_IP_HEADER]: '198.51.100.1',
        [WEB_PROXY_KEY_HEADER]: 'cle-inventee',
      },
    });
    const response = proxy(request);
    expect(forwarded(response, WEB_PROXY_IP_HEADER)).toBe('203.0.113.9');
    expect(forwarded(response, WEB_PROXY_KEY_HEADER)).toBe(SECRET);
  });

  it('sans clé configurée : les en-têtes envoyés par le visiteur sont retirés', async () => {
    const proxy = await loadProxy({ TRUST_PROXY: '1', WEB_PROXY_SECRET: undefined });
    const request = new NextRequest('https://sellwasl.example/api/v1/me', {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        [WEB_PROXY_IP_HEADER]: '198.51.100.1',
        [WEB_PROXY_KEY_HEADER]: 'cle-inventee',
      },
    });
    const response = proxy(request);
    expect(forwarded(response, WEB_PROXY_IP_HEADER)).toBeNull();
    expect(forwarded(response, WEB_PROXY_KEY_HEADER)).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).not.toContain(
      WEB_PROXY_KEY_HEADER,
    );
  });
});
