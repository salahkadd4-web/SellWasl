import { isPermissionModuleActive, type ModuleCode } from '@sellwasl/business-rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOpenApi } from '../src/docs/docs';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { Phones } from './phone';

interface Route {
  method: string;
  path: string;
  permission: string;
}

interface Actor {
  label: string;
  token: string;
  permissions: Set<string>;
  modules: ModuleCode[];
}

/**
 * Matrice des droits et des modules (phase 28) : chaque route protégée par un droit, pour chaque
 * rôle. Une route ajoutée plus tard est contrôlée d'office. Sans le droit, la garde refuse avant
 * tout traitement (aucune écriture) ; avec le droit, seules les lectures sont appelées.
 */
describe('matrice des droits et des modules (phase 28)', () => {
  let t: TestApp;
  let routes: Route[];
  const actors: Actor[] = [];
  const previous = process.env.TRUST_PROXY;
  let ip = 0;

  /** Une IP par requête : la matrice dépasserait la limite de 300 requêtes par minute et par IP. */
  async function send(route: Route, token: string) {
    ip += 1;
    const url = `${t.url}${route.path
      .replace('/api/v1', '')
      .replace(/\{[^}]+\}/g, '01a00000-0000-7000-8000-000000000000')}`;
    const reply = await fetch(url, {
      method: route.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Forwarded-For': `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`,
      },
      body: route.method === 'GET' ? undefined : '{}',
    });
    // Exports CSV ou fichiers : seules les réponses JSON portent un code d'erreur
    const json = reply.headers.get('content-type')?.includes('application/json');
    const body = json ? ((await reply.json()) as { error?: { code?: string } }) : null;
    if (!json) await reply.arrayBuffer();
    const code = body?.error?.code ?? null;
    return { status: reply.status, code };
  }

  async function actor(label: string, token: string): Promise<Actor> {
    const me = await call<{ permissions: string[]; modules: ModuleCode[] }>(t.url, 'GET', '/me', {
      token,
    });
    expect(me.status, label).toBe(200);
    return { label, token, permissions: new Set(me.body.permissions), modules: me.body.modules };
  }

  beforeAll(async () => {
    process.env.TRUST_PROXY = '1';
    t = await startApp();
    const doc = buildOpenApi(t.app) as unknown as {
      paths: Record<string, Record<string, { 'x-permission'?: string }>>;
    };
    routes = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops).flatMap(([method, op]) =>
        op['x-permission']
          ? [{ method: method.toUpperCase(), path, permission: op['x-permission'] }]
          : [],
      ),
    );
    const supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    const supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    const phones = new Phones(t, { 'DISTRI-ORAN': supA, 'CASHVAN-EST': supB });
    actors.push(
      await actor('admin', await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM')),
      await actor('superviseur', supA),
      await actor('comptable', await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT')),
      await actor('pré-vendeur', (await phones.get('V07')).token),
      await actor('livreur', (await phones.get('L01')).token),
      await actor('magasinier', (await phones.get('M01')).token),
      await actor('vendeur cash van', (await phones.get('C01', 'CASHVAN-EST')).token),
      await actor('admin cash van', await webLogin(t.url, 'CASHVAN-EST', 'B-ADM')),
    );
  });
  afterAll(async () => {
    await t.close();
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });

  it('relève toutes les routes protégées par un droit', () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(new Set(routes.map((r) => r.permission)).size).toBeGreaterThan(40);
  });

  it('sans le droit : refusé (403) pour chaque rôle, quelle que soit la méthode', async () => {
    const failures: string[] = [];
    for (const a of actors)
      for (const route of routes) {
        if (a.permissions.has(route.permission)) continue;
        const reply = await send(route, a.token);
        if (reply.status !== 403)
          failures.push(`${a.label} ${route.method} ${route.path} → ${reply.status} ${reply.code}`);
      }
    expect(failures).toEqual([]);
  });

  it('avec le droit mais module inactif : MODULE_DISABLED', async () => {
    const failures: string[] = [];
    let checked = 0;
    for (const a of actors)
      for (const route of routes) {
        if (!a.permissions.has(route.permission)) continue;
        if (isPermissionModuleActive(route.permission, a.modules)) continue;
        checked += 1;
        const reply = await send(route, a.token);
        if (reply.status !== 403 || reply.code !== 'MODULE_DISABLED')
          failures.push(`${a.label} ${route.method} ${route.path} → ${reply.status} ${reply.code}`);
      }
    expect(failures).toEqual([]);
    // L'entreprise cash van n'a pas la prévente : des routes au moins sont concernées
    expect(checked).toBeGreaterThan(0);
  });

  it('avec le droit et le module : les lectures ne sont jamais refusées', async () => {
    const failures: string[] = [];
    for (const a of actors)
      for (const route of routes) {
        if (route.method !== 'GET') continue;
        if (!a.permissions.has(route.permission)) continue;
        if (!isPermissionModuleActive(route.permission, a.modules)) continue;
        const reply = await send(route, a.token);
        if (reply.status === 403)
          failures.push(`${a.label} ${route.method} ${route.path} → ${reply.status} ${reply.code}`);
      }
    expect(failures).toEqual([]);
  });
});
