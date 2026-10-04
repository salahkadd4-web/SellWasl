import { describe, expect, it } from 'vitest';
import { boundingBox, normalizePolygon, polygonsOverlap } from './geo';
import { shiftToWeekdays } from './planning';

const square = (lng: number, lat: number, size = 1) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [lng, lat],
      [lng + size, lat],
      [lng + size, lat + size],
      [lng, lat + size],
      [lng, lat],
    ],
  ],
});

describe('polygones des parties (BR-ORG-02, BR-ORG-03)', () => {
  it('ferme l’anneau, retire les doublons et refuse un polygone invalide', () => {
    const result = normalizePolygon({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 0],
          [1, 1],
        ],
      ],
    });
    expect(result).toEqual({
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
    });
    expect(
      normalizePolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    ).toHaveProperty('error');
    expect(normalizePolygon({ type: 'Point', coordinates: [0, 0] })).toHaveProperty('error');
    expect(boundingBox(square(2, 3))).toEqual({ minLat: 3, maxLat: 4, minLng: 2, maxLng: 3 });
  });

  it('distingue des parties voisines d’un vrai chevauchement', () => {
    // Bord commun : pas de chevauchement
    expect(polygonsOverlap(square(0, 0), square(1, 0))).toBe(false);
    // Coin commun
    expect(polygonsOverlap(square(0, 0), square(1, 1))).toBe(false);
    // Croisement
    expect(polygonsOverlap(square(0, 0), square(0.5, 0.5))).toBe(true);
    // L'un dans l'autre, et polygones identiques
    expect(polygonsOverlap(square(0, 0, 4), square(1, 1))).toBe(true);
    expect(polygonsOverlap(square(0, 0), square(0, 0))).toBe(true);
    // Éloignés
    expect(polygonsOverlap(square(0, 0), square(5, 5))).toBe(false);
  });
});

describe('changement de jour d’une partie (BR-PLA-03)', () => {
  it('décale la date de référence au premier nouveau jour, même semaine', () => {
    // Samedi 3 octobre 2026 → la partie passe au mardi : mardi 6 octobre
    expect(shiftToWeekdays('2026-10-03', ['TUE'])).toBe('2026-10-06');
    expect(shiftToWeekdays('2026-10-03', ['SAT', 'TUE'])).toBe('2026-10-03');
    expect(shiftToWeekdays('2026-10-03', [])).toBeNull();
  });
});
