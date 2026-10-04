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

// Polygones dessinés par le superviseur (BR-ORG-02, BR-ORG-03, ARC-09) ---------------------------

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function boundingBox(polygon: GeoJsonPolygon): BoundingBox {
  const points =
    polygon.type === 'Polygon' ? polygon.coordinates.flat() : polygon.coordinates.flat(2);
  const lngs = points.map((p) => p[0]!);
  const lats = points.map((p) => p[1]!);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

/**
 * Vérifie un polygone simple et le normalise : anneau fermé, points en double retirés,
 * coordonnées arrondies à 7 décimales (environ 1 cm). Renvoie un message d'erreur sinon.
 */
export function normalizePolygon(
  input: unknown,
): { polygon: { type: 'Polygon'; coordinates: number[][][] } } | { error: string } {
  const value = input as { type?: unknown; coordinates?: unknown };
  if (value?.type !== 'Polygon' || !Array.isArray(value.coordinates)) {
    return { error: 'Un polygone GeoJSON est attendu.' };
  }
  const [ring] = value.coordinates as unknown[];
  if (!Array.isArray(ring)) return { error: 'Polygone vide.' };
  const points: number[][] = [];
  for (const raw of ring) {
    if (
      !Array.isArray(raw) ||
      typeof raw[0] !== 'number' ||
      typeof raw[1] !== 'number' ||
      Math.abs(raw[0]) > 180 ||
      Math.abs(raw[1]) > 90
    ) {
      return { error: 'Coordonnées invalides (longitude, latitude).' };
    }
    const point = [Math.round(raw[0] * 1e7) / 1e7, Math.round(raw[1] * 1e7) / 1e7];
    const last = points[points.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) points.push(point);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && points.length > 1 && first[0] === last[0] && first[1] === last[1]) {
    points.pop();
  }
  if (points.length < 3) return { error: 'Un polygone a au moins 3 points.' };
  return { polygon: { type: 'Polygon', coordinates: [[...points, points[0]!]] } };
}

const EPSILON = 1e-12;

function orientation(a: number[], b: number[], c: number[]): number {
  const value = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  return Math.abs(value) < EPSILON ? 0 : Math.sign(value);
}

/** Deux segments se croisent franchement (un simple contact ou un bord commun ne compte pas). */
function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function onBoundary(point: number[], ring: number[][]): boolean {
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    if (
      orientation(a, b, point) === 0 &&
      point[0]! >= Math.min(a[0]!, b[0]!) - EPSILON &&
      point[0]! <= Math.max(a[0]!, b[0]!) + EPSILON &&
      point[1]! >= Math.min(a[1]!, b[1]!) - EPSILON &&
      point[1]! <= Math.max(a[1]!, b[1]!) + EPSILON
    ) {
      return true;
    }
  }
  return false;
}

/** Point à l'intérieur, bord exclu. */
function strictlyInside(point: number[], polygon: GeoJsonPolygon & { type: 'Polygon' }): boolean {
  const ring = polygon.coordinates[0]!;
  if (onBoundary(point, ring)) return false;
  return pointInPolygon({ longitude: point[0]!, latitude: point[1]! }, polygon);
}

/** Points témoins d'un polygone : sommets, milieux des côtés et centre des sommets. */
function samplePoints(ring: number[][]): number[][] {
  const points = ring.slice(0, -1);
  const middles = points.map((p, i) => {
    const q = ring[i + 1]!;
    return [(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2];
  });
  const center = [
    points.reduce((s, p) => s + p[0]!, 0) / points.length,
    points.reduce((s, p) => s + p[1]!, 0) / points.length,
  ];
  return [...points, ...middles, center];
}

/**
 * Deux polygones se chevauchent : leurs intérieurs ont une partie commune. Des parties voisines
 * qui partagent un bord ne se chevauchent pas (BR-ORG-02, BR-ORG-03).
 */
export function polygonsOverlap(
  a: { type: 'Polygon'; coordinates: number[][][] },
  b: { type: 'Polygon'; coordinates: number[][][] },
): boolean {
  const boxA = boundingBox(a);
  const boxB = boundingBox(b);
  if (
    boxA.maxLat <= boxB.minLat ||
    boxB.maxLat <= boxA.minLat ||
    boxA.maxLng <= boxB.minLng ||
    boxB.maxLng <= boxA.minLng
  ) {
    return false;
  }
  const ringA = a.coordinates[0]!;
  const ringB = b.coordinates[0]!;
  for (let i = 0; i < ringA.length - 1; i += 1) {
    for (let j = 0; j < ringB.length - 1; j += 1) {
      if (segmentsCross(ringA[i]!, ringA[i + 1]!, ringB[j]!, ringB[j + 1]!)) return true;
    }
  }
  // Sans croisement : l'un contient l'autre, ou ils sont identiques
  const center = (ring: number[][]) => samplePoints(ring).at(-1)!;
  return (
    samplePoints(ringA).some((p) => strictlyInside(p, b)) ||
    samplePoints(ringB).some((p) => strictlyInside(p, a)) ||
    (strictlyInside(center(ringA), a) && strictlyInside(center(ringA), b)) ||
    (strictlyInside(center(ringB), b) && strictlyInside(center(ringB), a))
  );
}
