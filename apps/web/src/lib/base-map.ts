import {
  chooseMapProvider,
  MAP_ATTRIBUTIONS,
  type MapProviderName,
  OSM_TILE_URL,
  type ProviderChoice,
  rasterSource,
} from '@sellwasl/config';
import type L from 'leaflet';

/** Clé MapTiler du Web (docs/maptiler.md) ; absente : OpenStreetMap. */
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

/** Tuiles en échec avant la première affichée : le fournisseur est jugé indisponible. */
export const FAILED_TILES_LIMIT = 3;

let choice: Promise<ProviderChoice> | null = null;

/** Fournisseur de la session, vérifié une seule fois (une requête au style MapTiler). */
export function mapProvider(key = MAPTILER_KEY): Promise<ProviderChoice> {
  choice ??= chooseMapProvider(key, async (url) => ({ status: (await fetch(url)).status }));
  return choice;
}

/** Oublie le choix de la session (tests). */
export function resetMapProvider(): void {
  choice = null;
}

function warn(message: string) {
  if (process.env.NODE_ENV !== 'production') console.warn(`[carte] ${message}`);
}

/**
 * Pose le fond de carte d'une carte Leaflet : MapTiler, sinon OpenStreetMap (clé absente ou
 * refusée, quota dépassé, tuiles en échec). `onUnavailable` est appelé si OSM échoue aussi : la
 * carte garde ses tracés et ses points. Renvoie la fonction qui annule la pose.
 */
export function addBaseLayer(
  leaflet: typeof L,
  map: L.Map,
  onUnavailable: () => void,
  key = MAPTILER_KEY,
): () => void {
  let cancelled = false;
  void mapProvider(key).then(({ provider: chosen, reason }) => {
    if (cancelled) return;
    if (reason) warn(`OpenStreetMap utilisé : ${reason}.`);
    let provider: MapProviderName = chosen;
    const source = rasterSource(provider, key);
    const layer = leaflet.tileLayer(source.url, { attribution: source.attribution, maxZoom: 19 });
    let loaded = false;
    let failures = 0;
    layer.on('tileload', () => {
      loaded = true;
    });
    layer.on('tileerror', () => {
      if (loaded) return;
      failures += 1;
      if (failures < FAILED_TILES_LIMIT) return;
      if (provider === 'maptiler') {
        warn('tuiles MapTiler en échec : bascule sur OpenStreetMap.');
        provider = 'osm';
        failures = 0;
        map.attributionControl?.removeAttribution(MAP_ATTRIBUTIONS.maptiler);
        map.attributionControl?.addAttribution(MAP_ATTRIBUTIONS.osm);
        layer.options.attribution = MAP_ATTRIBUTIONS.osm;
        layer.setUrl(OSM_TILE_URL);
      } else if (failures === FAILED_TILES_LIMIT) {
        warn('tuiles OpenStreetMap en échec aussi : fond de carte indisponible.');
        onUnavailable();
      }
    });
    layer.addTo(map);
  });
  return () => {
    cancelled = true;
  };
}
