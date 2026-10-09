import type { CustomerDto, ProductDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

interface ErrorBody {
  error: { code: string; message: string; details?: { current?: number } };
}

/** Conflit de version sur les fiches modifiées depuis le Web (api.md §1, phase 25). */
describe('conflit de version (phase 25)', () => {
  let t: TestApp;
  let sup: string;
  let adm: string;
  let customer: CustomerDto;

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    adm = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    const type = await call<{ id: string }[]>(t.url, 'GET', '/customer-types', { token: sup });
    const created = await call<CustomerDto>(t.url, 'POST', '/customers', {
      token: sup,
      body: {
        code: `VER-${Date.now()}`,
        name: 'Client versionné',
        customerTypeId: type.body[0]!.id,
        // Loin de toute partie : client hors partie, sans ambiguïté
        latitude: 30,
        longitude: 5.2,
        frequency: 'WEEKLY',
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    customer = created.body;
  });
  afterAll(async () => {
    // Client de test retiré : d'autres suites comptent les clients à revoir
    await t.app.get(PrismaService).customer.updateMany({
      where: { name: { startsWith: 'Client versionné' } },
      data: { deletedAt: new Date() },
    });
    await t.close();
  });

  const patchCustomer = (body: object) =>
    call<CustomerDto>(t.url, 'PATCH', `/customers/${customer.id}`, { token: sup, body });

  it('bonne version : enregistrée, version + 1', async () => {
    const reply = await patchCustomer({ name: 'Client versionné A', version: customer.version });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(reply.body.version).toBe(customer.version + 1);
    customer = reply.body;
  });

  it('ancienne version : 409 VERSION_CONFLICT avec la version actuelle, rien écrit', async () => {
    const reply = await patchCustomer({ name: 'Client versionné périmé', version: 1 });
    expect(reply.status).toBe(409);
    const e = (reply.body as unknown as ErrorBody).error;
    expect(e.code).toBe('VERSION_CONFLICT');
    expect(e.details?.current).toBe(customer.version);
    expect(e.message).toContain('rechargez');
    const now = await call<CustomerDto>(t.url, 'GET', `/customers/${customer.id}`, { token: sup });
    expect(now.body.name).toBe('Client versionné A');
    expect(now.body.version).toBe(customer.version);
  });

  it('sans version : enregistrée comme avant', async () => {
    const reply = await patchCustomer({ name: 'Client versionné B' });
    expect(reply.status).toBe(200);
    expect(reply.body.version).toBeGreaterThan(customer.version);
    customer = reply.body;
  });

  it('deux modifications en même temps avec la même version : une passe, l’autre 409', async () => {
    const [a, b] = await Promise.all([
      patchCustomer({ name: 'Client versionné C', version: customer.version }),
      patchCustomer({ name: 'Client versionné D', version: customer.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = [a, b].find((r) => r.status === 409)!;
    expect((loser.body as unknown as ErrorBody).error.code).toBe('VERSION_CONFLICT');
    const now = await call<CustomerDto>(t.url, 'GET', `/customers/${customer.id}`, { token: sup });
    expect(now.body.version).toBe(customer.version + 1);
    customer = now.body;
  });

  it('version invalide : 400', async () => {
    expect((await patchCustomer({ version: 'x' })).status).toBe(400);
    expect((await patchCustomer({ version: 0 })).status).toBe(400);
    // Identifiant illisible : refus clair, comme sans version
    const bad = await call(t.url, 'PATCH', '/customers/pas-un-uuid', {
      token: sup,
      body: { name: 'x', version: 1 },
    });
    expect(bad.status).toBe(400);
  });

  it('produit : ancienne version refusée, bonne version acceptée', async () => {
    const products = await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', {
      token: sup,
    });
    const product = products.body[0]!;
    const path = `/products/${product.id}`;
    const stale = await call(t.url, 'PATCH', path, {
      token: sup,
      body: { name: product.name, version: product.version + 50 },
    });
    expect(stale.status).toBe(409);
    const ok = await call<ProductDto>(t.url, 'PATCH', path, {
      token: sup,
      body: { name: product.name, version: product.version },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.version).toBe(product.version + 1);
  });

  it('type de client : version avancée, ancienne version refusée', async () => {
    const created = await call<{ id: string; version: number }>(t.url, 'POST', '/customer-types', {
      token: adm,
      body: { code: `VT${Date.now() % 100000}`, name: 'Type versionné' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const path = `/customer-types/${created.body.id}`;
    const first = await call<{ version: number }>(t.url, 'PATCH', path, {
      token: adm,
      body: { name: 'Type versionné 2', version: created.body.version },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.version).toBe(created.body.version + 1);
    const again = await call(t.url, 'PATCH', path, {
      token: adm,
      body: { name: 'Type versionné 3', version: created.body.version },
    });
    expect(again.status).toBe(409);
    await t.app.get(PrismaService).customerType.update({
      where: { id: created.body.id },
      data: { isActive: false },
    });
  });

  it('paramètres : comparés à la dernière version', async () => {
    const current = await call<{ version: number; data: object }>(t.url, 'GET', '/settings', {
      token: adm,
    });
    const stale = await call(t.url, 'PUT', '/settings', {
      token: adm,
      body: { ...current.body.data, version: current.body.version + 50 },
    });
    expect(stale.status).toBe(409);
    expect((stale.body as unknown as ErrorBody).error.details?.current).toBe(current.body.version);
    const ok = await call<{ version: number }>(t.url, 'PUT', '/settings', {
      token: adm,
      body: { ...current.body.data, version: current.body.version },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.version).toBe(current.body.version + 1);
  });

  it('chaque fiche éditable est marquée dans la documentation', async () => {
    const reply = await fetch(t.url.replace('/api/v1', '/api/docs/openapi.json'));
    const doc = (await reply.json()) as {
      paths: Record<string, Record<string, { 'x-versioned'?: boolean }>>;
    };
    const versioned = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => op['x-versioned'])
        .map(([method]) => `${method.toUpperCase()} ${path.replace('/api/v1', '')}`),
    );
    expect(versioned.sort()).toEqual(
      [
        'PATCH /bonus-rules/{id}',
        'PATCH /customer-types/{id}',
        'PATCH /customers/{id}',
        'PATCH /incentive-rules/{id}',
        'PATCH /price-tiers/{id}',
        'PATCH /product-categories/{id}',
        'PATCH /product-ranges/{id}',
        'PATCH /products/{id}',
        'PATCH /products/{id}/units/{unitId}',
        'PATCH /products/{id}/variants/{variantId}',
        'PATCH /reasons/{id}',
        'PATCH /suppliers/{id}',
        'PATCH /territories/{id}',
        'PATCH /users/{id}',
        'PATCH /warehouses/{id}',
        'PUT /settings',
      ].sort(),
    );
  });
});
