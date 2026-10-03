import { describe, expect, it } from 'vitest';
import { assignPart, type PartCandidate, pointInPolygon } from './geo';
import { localDate, nextScheduledDate, weekdayOf } from './planning';

const square = (id: string, territoryId: string, lat: number, lng: number): PartCandidate => ({
  partId: id,
  territoryId,
  minLat: lat,
  maxLat: lat + 1,
  minLng: lng,
  maxLng: lng + 1,
  geojson: {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + 1, lat],
        [lng + 1, lat + 1],
        [lng, lat + 1],
        [lng, lat],
      ],
    ],
  },
});

describe('affectation à une partie (BR-ORG-04)', () => {
  const triangle = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [0, 4],
        [0, 0],
      ],
    ],
  };

  it('teste un point dans un polygone, bord compris', () => {
    expect(pointInPolygon({ latitude: 1, longitude: 1 }, triangle)).toBe(true);
    expect(pointInPolygon({ latitude: 3, longitude: 3 }, triangle)).toBe(false);
    expect(pointInPolygon({ latitude: 2, longitude: 2 }, triangle)).toBe(true);
  });

  it('trouve la partie, signale hors partie et les cas ambigus', () => {
    const a = square('A', 'T1', 0, 0);
    const b = square('B', 'T1', 0, 1);
    const c = square('C', 'T2', 0.5, 0.5);
    expect(assignPart({ latitude: 0.2, longitude: 0.2 }, [a, b])).toEqual({
      kind: 'ASSIGNED',
      territoryId: 'T1',
      partId: 'A',
    });
    expect(assignPart({ latitude: 5, longitude: 5 }, [a, b])).toEqual({ kind: 'OUT_OF_PART' });
    expect(assignPart({ latitude: 0.7, longitude: 0.7 }, [a, c]).kind).toBe('AMBIGUOUS');
  });
});

describe('date de référence (BR-PLA-03)', () => {
  const working = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] as const;

  it('prend le prochain jour prévu pour la partie, aujourd’hui compris', () => {
    expect(weekdayOf('2026-10-03')).toBe('SAT');
    expect(nextScheduledDate('2026-10-03', ['SAT'], working)).toBe('2026-10-03');
    expect(nextScheduledDate('2026-10-04', ['SAT'], working)).toBe('2026-10-10');
  });

  it('saute les jours fériés et les jours non travaillés', () => {
    expect(nextScheduledDate('2026-10-03', ['SAT'], working, ['2026-10-03'])).toBe('2026-10-10');
    expect(nextScheduledDate('2026-10-03', ['FRI'], working)).toBeNull();
  });

  it('calcule la date métier dans le fuseau de l’entreprise', () => {
    // 23 h 30 UTC le 3 octobre = 0 h 30 le 4 octobre à Alger (UTC+1)
    expect(localDate(new Date('2026-10-03T23:30:00Z'))).toBe('2026-10-04');
  });
});
