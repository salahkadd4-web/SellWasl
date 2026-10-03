import { weekdayOf } from '@sellwasl/business-rules';
import type {
  CustomerDto,
  FieldUserDevice,
  ImportPreview,
  Page,
  TerritoryOption,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, PASSWORD, startApp, type TestApp, webLogin } from './helpers';

// Secteurs de DISTRI-ORAN (seed) : 3101 sert le détail, 3102 le détail et les supérettes.
// Partie 1 de 3101 (samedi) : lat 35,68 à 35,70, lng -0,66 à -0,64 ; partie 2 (dimanche) à l'est.
const IN_3101_P1 = { latitude: 35.69, longitude: -0.65 };
const IN_3101_P2 = { latitude: 35.69, longitude: -0.63 };
const OUTSIDE = { latitude: 35.6, longitude: -0.65 };

/** Phase 11 : clients (UC-11, UC-12, UC-53, UC-83). */
describe('clients', () => {
  let t: TestApp;
  let sup: string;
  let admin: string;
  let types: { id: string; code: string }[];
  let territories: TerritoryOption[];
  const typeId = (code: string) => types.find((x) => x.code === code)!.id;
  const t3101 = () => territories.find((x) => x.code === '3101')!;

  const create = (token: string, body: Record<string, unknown>) =>
    call<CustomerDto>(t.url, 'POST', '/customers', {
      token,
      body: { customerTypeId: typeId('DETAIL'), ...body },
    });

  async function sellerToken(code: string): Promise<string> {
    const list = await call<FieldUserDevice[]>(t.url, 'GET', '/devices', { token: sup });
    const user = list.body.find((u) => u.code === code)!;
    const activation = await call<{ code: string }>(
      t.url,
      'POST',
      `/users/${user.userId}/activation-codes`,
      { token: sup },
    );
    const reply = await call<{ accessToken: string }>(t.url, 'POST', '/auth/device/activate', {
      body: { code: activation.body.code, password: PASSWORD },
    });
    return reply.body.accessToken;
  }

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    types = (
      await call<{ id: string; code: string }[]>(t.url, 'GET', '/customer-types', {
        token: sup,
      })
    ).body;
    territories = (await call<TerritoryOption[]>(t.url, 'GET', '/territories', { token: sup }))
      .body;
  });
  afterAll(() => t.close());

  it('liste, cherche et pagine les clients', async () => {
    const first = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?limit=5', {
      token: sup,
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(5);
    expect(first.body.total).toBeGreaterThan(60);
    const second = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      `/customers?limit=5&cursor=${first.body.nextCursor}`,
      { token: sup },
    );
    const ids = new Set(first.body.data.map((c) => c.id));
    expect(second.body.data.some((c) => ids.has(c.id))).toBe(false);
    expect(second.body.data[0]!.name >= first.body.data[4]!.name).toBe(true);

    const search = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?q=3101-001', {
      token: sup,
    });
    expect(search.body.data.map((c) => c.code)).toEqual(['3101-001']);
  });

  it('liste les clients à revoir : nouveaux et hors partie (BR-CLI-05)', async () => {
    const review = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?toReview=true', {
      token: sup,
    });
    expect(review.body.total).toBe(4);
    expect(review.body.data.every((c) => c.reviewReasons.includes('OUT_OF_PART'))).toBe(true);
  });

  it('affecte un nouveau client à sa partie et calcule sa date de référence (BR-ORG-04, BR-PLA-03)', async () => {
    const reply = await create(sup, { name: 'Épicerie du Port', code: 'T-001', ...IN_3101_P1 });
    expect(reply.status).toBe(201);
    expect(reply.body.territory?.code).toBe('3101');
    expect(reply.body.part?.number).toBe(1);
    expect(reply.body.isNew).toBe(false);
    expect(weekdayOf(reply.body.referenceDate!)).toBe('SAT');

    const duplicate = await create(sup, { name: 'Autre', code: 't-001' });
    expect(duplicate.status).toBe(409);
  });

  it('laisse hors partie un client dont le type n’est pas servi à cet endroit (BR-ORG-03)', async () => {
    const reply = await create(sup, {
      name: 'Supérette Est',
      customerTypeId: typeId('SUPERETTE'),
      ...IN_3101_P1,
    });
    expect(reply.body.part).toBeNull();
    expect(reply.body.reviewReasons).toEqual(['OUT_OF_PART']);

    const forced = await call(t.url, 'PATCH', `/customers/${reply.body.id}`, {
      token: sup,
      body: { partId: t3101().parts[0]!.id },
    });
    expect(forced.status).toBe(422);
  });

  it('demande au superviseur de choisir quand plusieurs parties conviennent', async () => {
    const prisma = t.app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    const territoryId = uuidv7();
    await prisma.territory.create({
      data: { id: territoryId, companyId: company.id, code: '3199', name: 'Superposé' },
    });
    await prisma.territoryCustomerType.create({
      data: { territoryId, customerTypeId: typeId('DETAIL') },
    });
    await prisma.territoryPart.create({
      data: {
        id: uuidv7(),
        companyId: company.id,
        territoryId,
        number: 1,
        name: 'Partie 1',
        geojson: {
          type: 'Polygon',
          coordinates: [
            [
              [-0.7, 35.6],
              [-0.6, 35.6],
              [-0.6, 35.8],
              [-0.7, 35.8],
              [-0.7, 35.6],
            ],
          ],
        },
        minLat: 35.6,
        maxLat: 35.8,
        minLng: -0.7,
        maxLng: -0.6,
      },
    });
    try {
      const ambiguous = await create(sup, { name: 'Client ambigu', ...IN_3101_P1 });
      expect(ambiguous.status).toBe(422);
      expect(ambiguous.body.error?.code).toBe('AMBIGUOUS_PART');
      const chosen = await create(sup, {
        name: 'Client ambigu',
        ...IN_3101_P1,
        partId: t3101().parts[0]!.id,
      });
      expect(chosen.status).toBe(201);
      expect(chosen.body.isPartForced).toBe(true);
    } finally {
      await prisma.territory.delete({ where: { id: territoryId } });
    }
  });

  it('modifie un client : nouvelle position, partie forcée puis libérée', async () => {
    const created = await create(sup, { name: 'Café Central', ...IN_3101_P1 });
    const id = created.body.id;
    const moved = await call<CustomerDto>(t.url, 'PATCH', `/customers/${id}`, {
      token: sup,
      body: IN_3101_P2,
    });
    expect(moved.body.part?.number).toBe(2);
    expect(weekdayOf(moved.body.referenceDate!)).toBe('SUN');

    const forced = await call<CustomerDto>(t.url, 'PATCH', `/customers/${id}`, {
      token: sup,
      body: { partId: t3101().parts[3]!.id, isCreditAllowed: true, creditLimitAmount: 30000 },
    });
    expect(forced.body).toMatchObject({ isPartForced: true, creditLimitAmount: 30000 });
    expect(forced.body.part?.number).toBe(4);

    // Une partie forcée ne bouge pas avec la position
    const kept = await call<CustomerDto>(t.url, 'PATCH', `/customers/${id}`, {
      token: sup,
      body: IN_3101_P1,
    });
    expect(kept.body.part?.number).toBe(4);

    const released = await call<CustomerDto>(t.url, 'PATCH', `/customers/${id}`, {
      token: sup,
      body: { partId: null },
    });
    expect(released.body).toMatchObject({ isPartForced: false });
    expect(released.body.part?.number).toBe(1);
  });

  it('désactive puis réactive un client (BR-CLI-04)', async () => {
    const created = await create(sup, { name: 'Boutique Fermée', ...IN_3101_P1 });
    const id = created.body.id;
    expect((await call(t.url, 'POST', `/customers/${id}/disable`, { token: sup })).status).toBe(
      200,
    );
    const active = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?q=Boutique Fermée', {
      token: sup,
    });
    expect(active.body.total).toBe(0);
    const all = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      '/customers?q=Boutique Fermée&status=ALL',
      { token: sup },
    );
    expect(all.body.data[0]?.status).toBe('INACTIVE');
    expect((await call(t.url, 'POST', `/customers/${id}/enable`, { token: sup })).status).toBe(200);
  });

  it('le vendeur crée un client dans son secteur, « nouveau » et sans crédit (BR-CLI-02, BR-CLI-03)', async () => {
    const seller = await sellerToken('V07');
    const reply = await create(seller, {
      name: 'Kiosque Nouveau',
      ...IN_3101_P2,
      isCreditAllowed: true,
      creditLimitAmount: 90000,
    });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ isNew: true, isCreditAllowed: false, isCashOnly: false });
    expect(reply.body.part?.number).toBe(2);
    expect(reply.body.reviewReasons).toEqual(['NEW']);

    const outside = await create(seller, { name: 'Kiosque Loin', ...OUTSIDE });
    expect(outside.body.territory?.code).toBe('3101');
    expect(outside.body.part).toBeNull();

    const notServed = await create(seller, {
      name: 'Supérette',
      customerTypeId: typeId('SUPERETTE'),
      ...IN_3101_P1,
    });
    expect(notServed.status).toBe(422);
    const noPosition = await create(seller, { name: 'Sans GPS' });
    expect(noPosition.status).toBe(422);

    // Le vendeur ne voit que les clients de son secteur
    const mine = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?limit=200&status=ALL', {
      token: seller,
    });
    expect(mine.body.data.every((c) => c.territory?.code === '3101')).toBe(true);

    // Le superviseur valide le nouveau client
    const validated = await call<CustomerDto>(
      t.url,
      'POST',
      `/customers/${reply.body.id}/validate`,
      { token: sup },
    );
    expect(validated.body.reviewReasons).toEqual([]);
    // Le vendeur ne peut pas modifier un client
    const patch = await call(t.url, 'PATCH', `/customers/${reply.body.id}`, {
      token: seller,
      body: { name: 'Autre' },
    });
    expect(patch.status).toBe(403);
  });

  it('isole les clients des autres entreprises et limite le comptable à la lecture', async () => {
    const created = await create(sup, { name: 'Client Oran', ...IN_3101_P1 });
    const other = await webLogin(t.url, 'CASHVAN-EST', 'B-ADM');
    expect(
      (await call(t.url, 'GET', `/customers/${created.body.id}`, { token: other })).status,
    ).toBe(404);
    const accountant = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    expect((await call(t.url, 'GET', '/customers', { token: accountant })).status).toBe(200);
    expect((await create(accountant, { name: 'Interdit' })).status).toBe(403);
  });

  it('importe un CSV : aperçu, erreurs, puis import des lignes valides (BR-IO-01)', async () => {
    const template = await fetch(`${t.url}/imports/templates/customers`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    expect(template.status).toBe(200);
    expect(await template.text()).toContain('nom;telephone');

    const csv = [
      'code;nom;téléphone;adresse;type;latitude;longitude;fréquence;crédit autorisé;plafond crédit',
      'IMP-1;Alimentation Import;0550000001;Oran;DETAIL;35,69;-0,65;2;oui;20 000',
      'IMP-2;"Supérette ""Le Phare""";;;Supérette;;;4;non;',
      'IMP-3;Type Inconnu;;;GROSSISTE;;;1;non;',
      '3101-001;Code Pris;;;DETAIL;;;1;non;',
      'IMP-4;Mauvaise Position;;;DETAIL;abc;-0,6;1;non;',
      ';;;;;;;;;',
    ].join('\r\n');
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'clients.csv');
    const upload = await fetch(`${t.url}/imports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    });
    expect(upload.status).toBe(201);
    const preview = (await upload.json()) as ImportPreview;
    expect(preview).toMatchObject({ status: 'PREVIEW', totalRows: 5, validRows: 2 });
    expect(preview.errors.map((e) => e.line)).toEqual([4, 5, 6]);
    expect(preview.sample[0]).toMatchObject({
      name: 'Alimentation Import',
      placement: '3101 · Partie 1',
    });
    expect(preview.sample[1]!.name).toBe('Supérette "Le Phare"');

    // Rien n'est importé avant la confirmation
    const before = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?q=IMP-', {
      token: admin,
    });
    expect(before.body.total).toBe(0);

    const confirmed = await call<ImportPreview>(t.url, 'POST', `/imports/${preview.id}/confirm`, {
      token: admin,
    });
    expect(confirmed.body).toMatchObject({ status: 'IMPORTED', importedRows: 2 });
    const again = await call(t.url, 'POST', `/imports/${preview.id}/confirm`, { token: admin });
    expect(again.status).toBe(409);

    const imported = await call<Page<CustomerDto>>(t.url, 'GET', '/customers?q=IMP-', {
      token: admin,
    });
    const byCode = Object.fromEntries(imported.body.data.map((c) => [c.code, c]));
    expect(byCode['IMP-1']).toMatchObject({
      frequency: 'BIWEEKLY',
      isCreditAllowed: true,
      creditLimitAmount: 20000,
    });
    expect(byCode['IMP-1']!.part?.number).toBe(1);
    expect(byCode['IMP-2']).toMatchObject({ frequency: 'EVERY_4_WEEKS', part: null });

    // Le superviseur n'importe pas
    expect((await call(t.url, 'GET', `/imports/${preview.id}`, { token: sup })).status).toBe(403);
  });
});
