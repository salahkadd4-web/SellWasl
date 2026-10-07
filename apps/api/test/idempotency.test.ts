import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import type { ProductDto } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../src/common/api-error';
import { RequirePermission } from '../src/common/auth-context';
import { Idempotent } from '../src/common/idempotency';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Route de test : compte ses exécutions, peut être lente ou échouer. */
@Controller('test-idempotency')
class IdempotentProbe {
  static runs = 0;

  @RequirePermission('stock.receive')
  @Idempotent()
  @Post()
  async create(@Body() body: { delay?: number; fail?: boolean; label?: string }) {
    IdempotentProbe.runs += 1;
    const run = IdempotentProbe.runs;
    if (body.delay) await new Promise((r) => setTimeout(r, body.delay));
    if (body.fail)
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', 'Échec voulu.');
    return { run, label: body.label ?? null };
  }
}

/** Idempotency-Key sur les créations d'argent et de stock (api.md §1, phase 25). */
describe('idempotence (phase 25)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;
  let supB: string;
  const post = (body: object, key?: string, token = sup) =>
    fetch(`${t.url}/test-idempotency`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

  beforeAll(async () => {
    t = await startApp([IdempotentProbe]);
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
  });
  afterAll(() => t.close());

  it('même clé, même contenu : exécutée une fois, même réponse rejouée', async () => {
    const before = IdempotentProbe.runs;
    const first = await post({ label: 'a' }, 'cle-rejeu-0001');
    const again = await post({ label: 'a' }, 'cle-rejeu-0001');
    expect(first.status).toBe(201);
    expect(again).toEqual(first);
    expect(IdempotentProbe.runs).toBe(before + 1);
  });

  it('même clé, autre contenu : 422 IDEMPOTENCY_MISMATCH', async () => {
    await post({ label: 'b' }, 'cle-contenu-0002');
    const other = await post({ label: 'autre' }, 'cle-contenu-0002');
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ error: { code: 'IDEMPOTENCY_MISMATCH' } });
  });

  it('deux requêtes en même temps : une exécution, l’autre 409 IN_PROGRESS', async () => {
    const before = IdempotentProbe.runs;
    const [a, b] = await Promise.all([
      post({ delay: 300 }, 'cle-parallele-0003'),
      post({ delay: 300 }, 'cle-parallele-0003'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body).toMatchObject({
      error: { code: 'IN_PROGRESS' },
    });
    expect(IdempotentProbe.runs).toBe(before + 1);
  });

  it('une erreur ne garde pas la clé : on peut réessayer', async () => {
    const failed = await post({ fail: true }, 'cle-erreur-0004');
    expect(failed.status).toBe(422);
    const retried = await post({ fail: true }, 'cle-erreur-0004');
    expect(retried.status).toBe(422);
    expect(await raw.idempotencyKey.count({ where: { key: 'cle-erreur-0004' } })).toBe(0);
  });

  it('clé propre à l’entreprise, sans en-tête rien ne change, clé trop courte refusée', async () => {
    const a = await post({ label: 'x' }, 'cle-partagee-0005');
    const b = await post({ label: 'x' }, 'cle-partagee-0005', supB);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.run).not.toBe(a.body.run);
    const before = IdempotentProbe.runs;
    await post({ label: 'sans' });
    await post({ label: 'sans' });
    expect(IdempotentProbe.runs).toBe(before + 2);
    expect((await post({}, 'court')).status).toBe(400);
  });

  it('route réelle : une entrée de stock envoyée deux fois n’est créée qu’une fois', async () => {
    const products = (
      await call<ProductDto[]>(t.url, 'GET', '/products?status=ACTIVE', { token: sup })
    ).body;
    const variant = products[0]!.variants[0]!;
    const unit = products[0]!.units.find((u) => u.isBase) ?? products[0]!.units[0]!;
    const depot = await raw.warehouse.findFirstOrThrow({
      where: { type: 'DEPOT', company: { code: 'DISTRI-ORAN' } },
    });
    const body = {
      warehouseId: depot.id,
      reference: `IDEM-${Date.now()}`,
      lines: [{ variantId: variant.id, unitId: unit.id, qty: 1 }],
    };
    const send = () =>
      fetch(`${t.url}/stock/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sup}`,
          'Idempotency-Key': `entree-${body.reference}`,
        },
        body: JSON.stringify(body),
      });
    const first = await send();
    expect(first.status, await first.clone().text()).toBe(201);
    const second = await send();
    expect(second.status).toBe(201);
    expect(await raw.stockReceipt.count({ where: { reference: body.reference } })).toBe(1);
  });
});
