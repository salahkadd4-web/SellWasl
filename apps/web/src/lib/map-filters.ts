import type { SupervisorMapDto } from '@sellwasl/validation';

/** Filtres de la carte du suivi : vide = tous. */
export interface MapFilters {
  territoryId: string;
  partId: string;
  userId: string;
}

export const NO_FILTER: MapFilters = { territoryId: '', partId: '', userId: '' };

/**
 * Carte filtrée par secteur, partie du jour et vendeur (combinés) : parties dessinées, clients
 * et positions des vendeurs retenus. Sans filtre, toutes les positions (livreurs compris).
 */
export function filterMap(data: SupervisorMapDto, f: MapFilters): SupervisorMapDto {
  if (!f.territoryId && !f.partId && !f.userId) return data;
  const sellers = data.sellers.filter(
    (s) =>
      (!f.territoryId || s.territoryId === f.territoryId) &&
      (!f.partId || s.partId === f.partId) &&
      (!f.userId || s.id === f.userId),
  );
  const sellerIds = new Set(sellers.map((s) => s.id));
  const sellerParts = new Set(sellers.map((s) => s.partId));
  return {
    ...data,
    sellers,
    parts: data.parts.filter(
      (p) =>
        (!f.territoryId || p.territoryId === f.territoryId) &&
        (!f.partId || p.id === f.partId) &&
        (!f.userId || sellerParts.has(p.id)),
    ),
    customers: data.customers.filter(
      (c) => sellerIds.has(c.userId) && (!f.partId || c.partId === f.partId),
    ),
    positions: data.positions.filter((p) => sellerIds.has(p.userId)),
  };
}

/** Choix proposés : secteurs, parties (du secteur choisi), vendeurs (du secteur et de la partie). */
export function filterOptions(data: SupervisorMapDto, f: MapFilters) {
  const territories = new Map<string, string>();
  for (const p of data.parts) territories.set(p.territoryId, p.territory);
  return {
    territories: [...territories.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    parts: data.parts
      .filter((p) => !f.territoryId || p.territoryId === f.territoryId)
      .map((p) => ({ value: p.id, label: `${p.territory} · ${p.name}` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    sellers: data.sellers
      .filter(
        (s) =>
          (!f.territoryId || s.territoryId === f.territoryId) &&
          (!f.partId || s.partId === f.partId),
      )
      .map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  };
}
