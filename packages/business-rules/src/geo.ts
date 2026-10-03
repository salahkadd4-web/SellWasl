// BR-ORG-04, BR-CLI-02 : affectation d'un client à une partie, partagée par l'API et le mobile.

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Polygone GeoJSON : anneaux de positions [longitude, latitude]. */
export type GeoJsonPolygon =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** Lancer de rayon sur un anneau ; un point sur le bord compte comme dedans. */
function inRing(point: LatLng, ring: number[][]): boolean {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    // Sur le segment
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-12 &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj)
    ) {
      return true;
    }
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygonRings(point: LatLng, rings: number[][][]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(point, outer)) return false;
  return !holes.some((hole) => inRing(point, hole));
}

export function pointInPolygon(point: LatLng, polygon: GeoJsonPolygon): boolean {
  if (polygon.type === 'Polygon') return inPolygonRings(point, polygon.coordinates);
  return polygon.coordinates.some((rings) => inPolygonRings(point, rings));
}

export interface PartCandidate {
  partId: string;
  territoryId: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  geojson: GeoJsonPolygon;
}

export type PartAssignment =
  | { kind: 'ASSIGNED'; territoryId: string; partId: string }
  | { kind: 'OUT_OF_PART' }
  | { kind: 'AMBIGUOUS'; options: { territoryId: string; partId: string }[] };

/**
 * Partie d'un client (BR-ORG-04) parmi les parties candidates : celles des secteurs qui servent
 * son type. Plusieurs parties possibles : le superviseur choisit. Aucune : « hors partie ».
 */
export function assignPart(point: LatLng, candidates: readonly PartCandidate[]): PartAssignment {
  const matches = candidates.filter(
    (c) =>
      point.latitude >= c.minLat &&
      point.latitude <= c.maxLat &&
      point.longitude >= c.minLng &&
      point.longitude <= c.maxLng &&
      pointInPolygon(point, c.geojson),
  );
  if (matches.length === 0) return { kind: 'OUT_OF_PART' };
  if (matches.length === 1) {
    const [m] = matches as [PartCandidate];
    return { kind: 'ASSIGNED', territoryId: m.territoryId, partId: m.partId };
  }
  return {
    kind: 'AMBIGUOUS',
    options: matches.map((m) => ({ territoryId: m.territoryId, partId: m.partId })),
  };
}
