import type { SupervisorMapDto } from '@sellwasl/validation';
import { describe, expect, it } from 'vitest';
import { filterMap, filterOptions, NO_FILTER } from './map-filters';

/** Deux secteurs : S1 (parties P1, P2 ; vendeurs V07 sur P1, V08 sur P2), S2 (P3 ; V09). */
const data: SupervisorMapDto = {
  date: '2027-06-05',
  parts: [
    { id: 'P1', name: 'Partie 1', territory: 'S1 · Est', territoryId: 'S1', geojson: null },
    { id: 'P2', name: 'Partie 2', territory: 'S1 · Est', territoryId: 'S1', geojson: null },
    { id: 'P3', name: 'Partie 1', territory: 'S2 · Ouest', territoryId: 'S2', geojson: null },
  ],
  customers: [
    { id: 'c1', name: 'A', latitude: 1, longitude: 1, visited: true, userId: 'V07', partId: 'P1' },
    { id: 'c2', name: 'B', latitude: 1, longitude: 1, visited: false, userId: 'V08', partId: 'P2' },
    { id: 'c3', name: 'C', latitude: 1, longitude: 1, visited: false, userId: 'V09', partId: 'P3' },
  ],
  positions: [
    { userId: 'V07', name: 'Ahmed', latitude: 1, longitude: 1, at: '' },
    { userId: 'L01', name: 'Youcef', latitude: 1, longitude: 1, at: '' },
  ],
  sellers: [
    { id: 'V07', code: 'V07', name: 'Ahmed', territoryId: 'S1', partId: 'P1' },
    { id: 'V08', code: 'V08', name: 'Karim', territoryId: 'S1', partId: 'P2' },
    { id: 'V09', code: 'V09', name: 'Sami', territoryId: 'S2', partId: 'P3' },
  ],
};
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('filtres de la carte du suivi', () => {
  it('sans filtre : tout, positions des livreurs comprises', () => {
    expect(filterMap(data, NO_FILTER)).toBe(data);
  });

  it('secteur : ses parties, ses clients, ses vendeurs', () => {
    const out = filterMap(data, { ...NO_FILTER, territoryId: 'S1' });
    expect(ids(out.parts)).toEqual(['P1', 'P2']);
    expect(ids(out.customers)).toEqual(['c1', 'c2']);
    expect(out.positions.map((p) => p.userId)).toEqual(['V07']);
  });

  it('partie et vendeur, combinés avec le secteur', () => {
    expect(ids(filterMap(data, { ...NO_FILTER, partId: 'P2' }).customers)).toEqual(['c2']);
    const v09 = filterMap(data, { ...NO_FILTER, userId: 'V09' });
    expect(ids(v09.parts)).toEqual(['P3']);
    expect(ids(v09.customers)).toEqual(['c3']);
    // Vendeur hors du secteur choisi : rien
    expect(filterMap(data, { territoryId: 'S1', partId: '', userId: 'V09' }).customers).toEqual(
      [],
    );
  });

  it('choix proposés : parties du secteur, vendeurs du secteur et de la partie', () => {
    const all = filterOptions(data, NO_FILTER);
    expect(all.territories.map((t) => t.value)).toEqual(['S1', 'S2']);
    const s1 = filterOptions(data, { ...NO_FILTER, territoryId: 'S1' });
    expect(s1.parts.map((p) => p.value)).toEqual(['P1', 'P2']);
    expect(s1.sellers.map((s) => s.value)).toEqual(['V07', 'V08']);
    const p2 = filterOptions(data, { territoryId: 'S1', partId: 'P2', userId: '' });
    expect(p2.sellers.map((s) => s.value)).toEqual(['V08']);
  });
});
