import { weekdayOf } from '@sellwasl/business-rules';
import type {
  CustomerDto,
  CustomerPosition,
  Page,
  PartsChangeResult,
  TerritoryDto,
  TerritoryOverlap,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Rectangle GeoJSON (longitude, latitude). */
const box = (minLng: number, minLat: number, maxLng: number, maxLat: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ],
});

// CASHVAN-EST (seed) : secteur 2501 en grille 3 × 2 de 0,02°, à partir de (36,34 ; 6,58).
// Partie 1 : lat 36,34 à 36,36, lng 6,58 à 6,60 (samedi) ; partie 4 au-dessus (mardi).

/** Phase 13 : secteurs, parties, planning et carte (UC-50 à UC-53). */
describe('secteurs et parties', () => {
  let t: TestApp;
  let sup: string;
  let typeIds: Record<string, string>;
  let territories: TerritoryDto[];
  const territory = (code: string) => territories.find((x) => x.code === code)!;
  const reload = async () => {
    territories = (await call<TerritoryDto[]>(t.url, 'GET', '/territories', { token: sup })).body;
  };

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    const types = await call<{ id: string; code: string }[]>(t.url, 'GET', '/customer-types', {
      token: sup,
    });
    typeIds = Object.fromEntries(types.body.map((x) => [x.code, x.id]));
    await reload();
  });
  afterAll(() => t.close());

  it('liste les secteurs avec leurs parties, leur planning et leurs clients', async () => {
    expect(territories.map((x) => x.code)).toEqual(['2501', '2502']);
    const t2501 = territory('2501');
    expect(t2501.parts).toHaveLength(6);
    expect(t2501.schedule).toHaveLength(6);
    expect(t2501.seller?.code).toBe('C01');
    expect(t2501.outOfPartCount).toBe(2);
    expect(t2501.parts.reduce((s, p) => s + p.customerCount, 0)).toBe(30);
    // Parties voisines : bords communs, pas de chevauchement
    const overlaps = await call<TerritoryOverlap[]>(t.url, 'GET', '/territories/overlaps', {
      token: sup,
    });
    expect(overlaps.body).toEqual([]);
  });

  it('crée un secteur ; un vendeur n’a qu’un secteur (BR-ORG-01)', async () => {
    const sellers = await call<{ id: string; code: string }[]>(t.url, 'GET', '/users', {
      token: await webLogin(t.url, 'CASHVAN-EST', 'B-ADM'),
    });
    const c01 = sellers.body.find((u) => u.code === 'C01')!;
    const taken = await call(t.url, 'POST', '/territories', {
      token: sup,
      body: { code: '2599', name: 'Gros', customerTypeIds: [typeIds.GROS], sellerUserId: c01.id },
    });
    expect(taken.status).toBe(422);

    const created = await call<TerritoryDto>(t.url, 'POST', '/territories', {
      token: sup,
      body: {
        code: '2599',
        name: 'Gros Constantine',
        customerTypeIds: [typeIds.GROS],
        partCount: 2,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: '2599', partCount: 2, parts: [], seller: null });

    const accountant = await webLogin(t.url, 'CASHVAN-EST', 'B-CPT');
    const forbidden = await call(t.url, 'POST', '/territories', {
      token: accountant,
      body: { code: '2598', name: 'X', customerTypeIds: [typeIds.GROS] },
    });
    expect(forbidden.status).toBe(403);
  });

  it('dessine les parties : aperçu des clients déplacés, puis enregistrement (BR-ORG-06)', async () => {
    await reload();
    const gros = territory('2599');
    // Un client « Gros » sans partie, au nord de la ville
    const client = await call<CustomerDto>(t.url, 'POST', '/customers', {
      token: sup,
      body: {
        name: 'Grossiste du Nord',
        customerTypeId: typeIds.GROS,
        latitude: 36.45,
        longitude: 6.65,
      },
    });
    expect(client.body.part).toBeNull();

    const parts = {
      parts: [
        { number: 1, name: 'Nord', geojson: box(6.6, 36.4, 6.7, 36.5) },
        { number: 2, name: 'Sud', geojson: box(6.6, 36.3, 6.7, 36.4) },
      ],
    };
    const preview = await call<PartsChangeResult>(
      t.url,
      'PUT',
      `/territories/${gros.id}/parts?dryRun=true`,
      { token: sup, body: parts },
    );
    expect(preview.status).toBe(200);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.moved).toEqual([
      expect.objectContaining({
        name: 'Grossiste du Nord',
        from: 'hors partie',
        to: '2599 · Nord',
      }),
    ]);
    // Rien n'est enregistré pendant l'aperçu
    const still = await call<CustomerDto>(t.url, 'GET', `/customers/${client.body.id}`, {
      token: sup,
    });
    expect(still.body.part).toBeNull();

    const saved = await call<PartsChangeResult>(t.url, 'PUT', `/territories/${gros.id}/parts`, {
      token: sup,
      body: parts,
    });
    expect(saved.body.applied).toBe(true);
    const placed = await call<CustomerDto>(t.url, 'GET', `/customers/${client.body.id}`, {
      token: sup,
    });
    expect(placed.body.part?.name).toBe('Nord');

    // Deux parties d'un même secteur ne se chevauchent pas (BR-ORG-02)
    const overlapping = await call(t.url, 'PUT', `/territories/${gros.id}/parts`, {
      token: sup,
      body: {
        parts: [
          { number: 1, name: 'Nord', geojson: box(6.6, 36.4, 6.7, 36.5) },
          { number: 2, name: 'Sud', geojson: box(6.6, 36.35, 6.7, 36.45) },
        ],
      },
    });
    expect(overlapping.status).toBe(422);
    const tooMany = await call(t.url, 'PUT', `/territories/${gros.id}/parts`, {
      token: sup,
      body: { parts: [{ number: 3, name: 'Trois', geojson: box(6.6, 36.3, 6.7, 36.4) }] },
    });
    expect(tooMany.status).toBe(422);
  });

  it('signale la superposition de deux secteurs qui servent un même type (BR-ORG-03)', async () => {
    const created = await call<TerritoryDto>(t.url, 'POST', '/territories', {
      token: sup,
      body: { code: '2597', name: 'Détail bis', customerTypeIds: [typeIds.DETAIL], partCount: 1 },
    });
    const preview = await call<PartsChangeResult>(
      t.url,
      'PUT',
      `/territories/${created.body.id}/parts?dryRun=true`,
      {
        token: sup,
        body: { parts: [{ number: 1, name: 'Centre', geojson: box(6.57, 36.33, 6.59, 36.35) }] },
      },
    );
    expect(preview.body.overlaps).toEqual([
      expect.objectContaining({
        kind: 'SAME_CUSTOMER_TYPE',
        b: expect.objectContaining({ territoryCode: '2501', partName: 'Partie 1' }),
        customerTypes: ['Détail'],
      }),
    ]);
  });

  it('réaffecte les clients quand une partie est réduite, sauf les parties forcées', async () => {
    await reload();
    const t2501 = territory('2501');
    const part1 = t2501.parts.find((p) => p.number === 1)!;
    const before = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      `/customers?partId=${part1.id}&limit=50`,
      { token: sup },
    );
    expect(before.body.total).toBe(5);
    // Un client de la partie 1 est forcé dans sa partie
    const forced = before.body.data[0]!;
    await call(t.url, 'PATCH', `/customers/${forced.id}`, {
      token: sup,
      body: { partId: part1.id },
    });

    // La partie 1 est réduite à un mince bandeau : ses clients passent hors partie
    const parts = t2501.parts.map((p) => ({
      number: p.number,
      name: p.name,
      geojson: p.number === 1 ? box(6.58, 36.34, 6.6, 36.3401) : p.geojson,
    }));
    const preview = await call<PartsChangeResult>(
      t.url,
      'PUT',
      `/territories/${t2501.id}/parts?dryRun=true`,
      { token: sup, body: { parts } },
    );
    const moved = preview.body.moved.filter((m) => m.from === '2501 · Partie 1');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((m) => m.customerId === forced.id)).toBe(false);
    expect(moved.every((m) => m.to === 'hors partie')).toBe(true);
  });

  it('change le planning et décale la date de référence des clients (BR-ORG-07, BR-PLA-03)', async () => {
    await reload();
    const t2501 = territory('2501');
    const part = (n: number) => t2501.parts.find((p) => p.number === n)!.id;
    const saved = await call<TerritoryDto>(t.url, 'PUT', `/territories/${t2501.id}/schedule`, {
      token: sup,
      body: {
        days: [
          { weekday: 'SAT', partId: part(4) },
          { weekday: 'TUE', partId: part(1) },
        ],
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.schedule.find((s) => s.weekday === 'TUE')?.partId).toBe(part(1));
    const customers = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      `/customers?partId=${part(1)}&limit=50`,
      { token: sup },
    );
    const dates = customers.body.data.map((c) => c.referenceDate).filter(Boolean) as string[];
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d) => weekdayOf(d) === 'TUE')).toBe(true);

    const foreign = await call(t.url, 'PUT', `/territories/${t2501.id}/schedule`, {
      token: sup,
      body: { days: [{ weekday: 'SUN', partId: territory('2502').parts[0]!.id }] },
    });
    expect(foreign.status).toBe(422);
  });

  it('montre les clients sur la carte et les place par sélection (UC-53)', async () => {
    await reload();
    const positions = await call<CustomerPosition[]>(t.url, 'GET', '/map/customers', {
      token: sup,
    });
    expect(positions.body.length).toBeGreaterThan(60);
    const outside = positions.body.filter(
      (c) => c.territoryId === territory('2502').id && c.partId === null,
    );
    expect(outside).toHaveLength(2);
    const target = territory('2502').parts[0]!;
    const assigned = await call<{ updated: number }>(t.url, 'POST', '/customers/assign-part', {
      token: sup,
      body: { customerIds: outside.map((c) => c.id), partId: target.id },
    });
    expect(assigned.body.updated).toBe(2);
    const after = await call<CustomerDto>(t.url, 'GET', `/customers/${outside[0]!.id}`, {
      token: sup,
    });
    expect(after.body).toMatchObject({ isPartForced: true, part: { id: target.id } });

    // Retour au calcul automatique : hors partie de nouveau
    await call(t.url, 'POST', '/customers/assign-part', {
      token: sup,
      body: { customerIds: [outside[0]!.id], partId: null },
    });
    const auto = await call<CustomerDto>(t.url, 'GET', `/customers/${outside[0]!.id}`, {
      token: sup,
    });
    expect(auto.body).toMatchObject({ isPartForced: false, part: null });

    expect((await call(t.url, 'GET', '/map/field-users', { token: sup })).status).toBe(200);
  });
});
