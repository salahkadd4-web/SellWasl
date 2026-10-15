import type { ImportPreview, OpeningDebtState } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Soldes d'ouverture des dettes (BR-PAY-09). */
describe('soldes d’ouverture', () => {
  let t: TestApp;
  let prisma: PrismaService;
  let admin: string;
  let compta: string;
  let sup: string;
  let companyId: string;
  let detailTypeId: string;
  const created: string[] = [];

  async function newCustomer(code: string): Promise<string> {
    const r = await call<{ id: string }>(t.url, 'POST', '/customers', {
      token: admin,
      body: { code, name: `Client ${code}`, customerTypeId: detailTypeId },
    });
    expect(r.status).toBe(201);
    created.push(r.body.id);
    return r.body.id;
  }
  const setOpening = (token: string, id: string, amount: number) =>
    call<OpeningDebtState>(t.url, 'PUT', `/customers/${id}/opening-debt`, {
      token,
      body: { amount },
    });
  const creditSale = async (customerId: string, amount: bigint) => {
    await prisma.customerDebtEntry.create({
      data: {
        id: uuidv7(),
        companyId,
        customerId,
        kind: 'CREDIT_SALE',
        amount,
        occurredAt: new Date(),
      },
    });
    await prisma.customer.update({
      where: { id: customerId },
      data: { debtAmount: { increment: amount } },
    });
  };

  async function uploadOpening(token: string, csv: string) {
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'soldes.csv');
    const r = await fetch(`${t.url}/opening-debts/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: r.status, body: (await r.json()) as ImportPreview };
  }

  beforeAll(async () => {
    t = await startApp();
    prisma = t.app.get(PrismaService);
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    compta = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } })).id;
    detailTypeId = (
      await prisma.customerType.findFirstOrThrow({ where: { companyId, code: 'DETAIL' } })
    ).id;
  });
  afterAll(async () => {
    // Clients de test retirés : sans position, ils fausseraient les « clients à revoir » comptés
    // par d'autres suites
    await prisma.customer.updateMany({
      where: { id: { in: created } },
      data: { deletedAt: new Date() },
    });
    await t.close();
  });

  it('saisit, corrige, remet à zéro, sans écriture si le montant ne change pas', async () => {
    const id = await newCustomer('OUV-1');
    const first = await setOpening(compta, id, 12000);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      openingDebtAmount: 12000,
      openingDebtEditable: true,
      debtAmount: 12000,
    });
    expect((await setOpening(admin, id, 10000)).body.debtAmount).toBe(10000);
    expect((await setOpening(admin, id, 10000)).body.debtAmount).toBe(10000);
    const entries = await prisma.customerDebtEntry.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => [e.kind, Number(e.amount)])).toEqual([
      ['OPENING_BALANCE', 12000],
      ['OPENING_BALANCE', -2000],
    ]);
    expect((await setOpening(admin, id, 0)).body).toMatchObject({
      openingDebtAmount: 0,
      debtAmount: 0,
    });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'debt.opening' },
    });
    expect(audit).toHaveLength(3);
    const state = await call<OpeningDebtState>(t.url, 'GET', `/customers/${id}/opening-debt`, {
      token: compta,
    });
    expect(state.body).toEqual({ openingDebtAmount: 0, openingDebtEditable: true, debtAmount: 0 });
  });

  it('fige le solde dès la première autre écriture de dette', async () => {
    const id = await newCustomer('OUV-2');
    await setOpening(admin, id, 5000);
    await creditSale(id, 3000n);
    const refused = await setOpening(admin, id, 6000);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.message).toContain('Solde figé');
    const state = await call<OpeningDebtState>(t.url, 'GET', `/customers/${id}/opening-debt`, {
      token: admin,
    });
    expect(state.body).toEqual({
      openingDebtAmount: 5000,
      openingDebtEditable: false,
      debtAmount: 8000,
    });
  });

  it('refuse sans le droit, un montant invalide, un client d’une autre entreprise', async () => {
    const id = await newCustomer('OUV-3');
    expect((await setOpening(sup, id, 1000)).status).toBe(403);
    expect((await setOpening(admin, id, -1)).status).toBe(400);
    expect((await setOpening(admin, id, 10.5)).status).toBe(400);
    const other = await prisma.customer.findFirstOrThrow({
      where: { company: { code: 'CASHVAN-EST' } },
    });
    expect((await setOpening(admin, other.id, 1000)).status).toBe(404);
    expect(
      (await call(t.url, 'GET', `/customers/${other.id}/opening-debt`, { token: admin })).status,
    ).toBe(404);
  });

  it('importe les soldes : aperçu, erreurs, revérification, audit unique', async () => {
    const a = await newCustomer('IMPO-A');
    const b = await newCustomer('IMPO-B');
    await newCustomer('IMPO-C');
    const template = await fetch(`${t.url}/opening-debts/template`, {
      headers: { Authorization: `Bearer ${compta}` },
    });
    expect(template.status).toBe(200);
    expect(await template.text()).toContain('code;nom;dette');

    const csv = [
      'code;nom;dette',
      'impo-a;Client A;12 000',
      'IMPO-B;;3500',
      'IMPO-C;;12000,50',
      'INCONNU;;100',
      'IMPO-A;;1',
    ].join('\r\n');
    const { status, body: preview } = await uploadOpening(compta, csv);
    expect(status).toBe(201);
    expect(preview).toMatchObject({ kind: 'OPENING_DEBTS', totalRows: 5, validRows: 2 });
    expect(preview.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(preview.columns).toEqual(['Code', 'Client', 'Solde actuel', 'Nouveau solde']);
    const [code, name, before, after] = preview.sample[0]!.values;
    expect([code, name, before]).toEqual(['IMPO-A', 'Client IMPO-A', '0 DA']);
    expect(after).toMatch(/^12\s000 DA$/);

    // B est figé entre l'aperçu et la confirmation : sa ligne passe en erreur
    await creditSale(b, 100n);
    const confirmed = await call<ImportPreview>(
      t.url,
      'POST',
      `/opening-debts/imports/${preview.id}/confirm`,
      { token: compta },
    );
    expect(confirmed.body).toMatchObject({ status: 'IMPORTED', importedRows: 1 });
    expect(confirmed.body.errors.some((e) => e.message.includes('figé'))).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a } })).debtAmount).toBe(12000n);
    const audit = await prisma.auditLog.findMany({ where: { entityId: preview.id } });
    expect(audit.map((x) => x.action)).toEqual(['import.opening_debts']);
  });

  it('cloisonne les imports : soldes et clients ne se croisent pas', async () => {
    const { body: opening } = await uploadOpening(admin, 'code;dette\r\nIMPO-A;5\r\n');
    expect((await call(t.url, 'GET', `/imports/${opening.id}`, { token: admin })).status).toBe(404);
    expect(
      (await call(t.url, 'POST', `/imports/${opening.id}/confirm`, { token: admin })).status,
    ).toBe(404);
    expect((await uploadOpening(sup, 'code;dette\r\n')).status).toBe(403);
    const form = new FormData();
    form.append('kind', 'OPENING_DEBTS');
    form.append('file', new Blob(['code;dette\r\n'], { type: 'text/csv' }), 'x.csv');
    const viaImports = await fetch(`${t.url}/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    });
    expect(viaImports.status).toBe(400);
    expect(
      (await call(t.url, 'GET', `/opening-debts/imports/${opening.id}`, { token: compta })).status,
    ).toBe(200);
  });
});
