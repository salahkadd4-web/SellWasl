/**
 * Fonds de carte (docs/maptiler.md) : MapTiler en principal, OpenStreetMap en secours quand la clé
 * manque, est refusée (401, 403), quand le quota est dépassé (429) ou quand MapTiler ne répond pas.
 * Partagé par le Web (Leaflet, tuiles raster) et le mobile (MapLibre, style vectoriel).
 */

/** Style MapTiler utilisé partout : le changer ici suffit (ex. « basic-v2 », « bright-v2 »). */
export const MAPTILER_STYLE = 'streets-v2';

export type MapProviderName = 'maptiler' | 'osm';

export const MAP_ATTRIBUTIONS: Record<MapProviderName, string> = {
  maptiler: '© MapTiler © OpenStreetMap contributors',
  osm: '© OpenStreetMap contributors',
};

/** Tuiles OSM : secours seulement, sans préchargement (politique d'usage d'OpenStreetMap). */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Clé lisible : vide ou faite d'espaces, elle est absente. */
function cleanKey(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

/** Style vectoriel MapTiler (mobile, MapLibre) ; aussi interrogé pour vérifier la clé. */
export function maptilerStyleUrl(key: string, style = MAPTILER_STYLE): string {
  return `https://api.maptiler.com/maps/${style}/style.json?key=${encodeURIComponent(key)}`;
}

/** Tuiles raster 256 px du même style (Web, Leaflet). */
export function maptilerTileUrl(key: string, style = MAPTILER_STYLE): string {
  return `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
}

/** Réponse de MapTiler qui impose le secours : clé refusée ou quota dépassé. */
export function isRefused(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export interface ProviderChoice {
  provider: MapProviderName;
  /** Pourquoi OSM a été choisi (journal de développement), null pour MapTiler. */
  reason: string | null;
}

/** Fetch minimal : celui du navigateur ou de React Native. */
export type MapFetch = (url: string) => Promise<{ status: number }>;

/**
 * Choisit le fournisseur : une seule requête au style MapTiler (une tuile en image ne donne pas
 * le code HTTP). Clé absente, refusée, quota dépassé ou MapTiler injoignable : OSM.
 */
export async function chooseMapProvider(
  key: string | null | undefined,
  fetcher: MapFetch,
): Promise<ProviderChoice> {
  const clean = cleanKey(key);
  if (!clean) return { provider: 'osm', reason: 'clé MapTiler absente' };
  try {
    const { status } = await fetcher(maptilerStyleUrl(clean));
    if (isRefused(status))
      return {
        provider: 'osm',
        reason:
          status === 429 ? 'quota MapTiler dépassé (429)' : `clé MapTiler refusée (${status})`,
      };
    if (status >= 400) return { provider: 'osm', reason: `MapTiler indisponible (${status})` };
    return { provider: 'maptiler', reason: null };
  } catch {
    return { provider: 'osm', reason: 'MapTiler injoignable' };
  }
}

/** Fond de carte de Leaflet pour le fournisseur choisi. */
export function rasterSource(provider: MapProviderName, key: string | null | undefined) {
  const clean = cleanKey(key);
  return provider === 'maptiler' && clean
    ? { url: maptilerTileUrl(clean), attribution: MAP_ATTRIBUTIONS.maptiler }
    : { url: OSM_TILE_URL, attribution: MAP_ATTRIBUTIONS.osm };
}
