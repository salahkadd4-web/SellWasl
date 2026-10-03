import { ClsService } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TENANT_KEY,
  TENANT_PRISMA,
  type TenantPrisma,
  TenantViolationError,
} from '../src/tenancy/tenant-prisma';
import { startApp, type TestApp } from './helpers';

/** Phase 5 : le client filtré ne laisse jamais passer les données d'une autre entreprise. */
describe('isolation des entreprises (client Prisma filtré)', () => {
  let t: TestApp;
  let db: TenantPrisma;
  let cls: ClsService;
  let companyA: string;
  let companyB: string;
  let customerOfB: string;

  const asCompany = <T>(companyId: string, fn: () => Promise<T>) =>
    cls.run(async () => {
      cls.set(TENANT_KEY, companyId);
      return fn();
    });

  beforeAll(async () => {
    t = await startApp();
    db = t.app.get(TENANT_PRISMA);
    cls = t.app.get(ClsService);
    const raw = t.app.get(PrismaService);
    companyA = (await raw.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
    companyB = (await raw.company.findUniqueOrThrow({ where: { code: 'CASHVAN-EST' } })).id;
    customerOfB = (await raw.customer.findFirstOrThrow({ where: { companyId: companyB } })).id;
  });
  afterAll(() => t.close());

  it("ne lit que les clients de l'entreprise courante", async () => {
    const customers = await asCompany(companyA, () => db.customer.findMany());
    // Le nombre dépend des tests déjà passés : on le compare au total réel de l'entreprise
    expect(customers.length).toBe(
      await t.app.get(PrismaService).customer.count({ where: { companyId: companyA } }),
    );
    expect(customers.length).toBeGreaterThan(0);
    expect(customers.every((c) => c.companyId === companyA)).toBe(true);
  });

  it("ne trouve pas un client d'une autre entreprise, même par son identifiant (IDOR)", async () => {
    expect(
      await asCompany(companyA, () => db.customer.findUnique({ where: { id: customerOfB } })),
    ).toBeNull();
    expect(await asCompany(companyA, () => db.customer.count({ where: { id: customerOfB } }))).toBe(
      0,
    );
  });

  it("ne modifie ni ne supprime une ligne d'une autre entreprise", async () => {
    await expect(
      asCompany(companyA, () =>
        db.customer.update({ where: { id: customerOfB }, data: { name: 'piraté' } }),
      ),
    ).rejects.toThrow();
    const updated = await asCompany(companyA, () =>
      db.customer.updateMany({ where: { id: customerOfB }, data: { name: 'piraté' } }),
    );
    expect(updated.count).toBe(0);
  });

  it('refuse une création dans une autre entreprise', async () => {
    await expect(
      asCompany(companyA, () =>
        db.holiday.create({
          data: {
            id: crypto.randomUUID(),
            companyId: companyB,
            date: new Date('2030-01-01'),
            label: 'x',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('refuse un filtre explicite sur une autre entreprise', async () => {
    await expect(
      asCompany(companyA, () => db.customer.findMany({ where: { companyId: companyB } })),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it("ne voit que sa propre fiche d'entreprise", async () => {
    const companies = await asCompany(companyA, () => db.company.findMany());
    expect(companies.map((c) => c.id)).toEqual([companyA]);
  });

  it('refuse toute requête sans entreprise dans le contexte', async () => {
    await expect(db.customer.findMany()).rejects.toBeInstanceOf(TenantViolationError);
  });

  it("laisse passer les tables qui n'appartiennent à aucune entreprise", async () => {
    expect(await db.permission.count()).toBeGreaterThan(60);
  });
});
