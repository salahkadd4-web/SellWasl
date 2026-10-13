import { TransformRequestManager } from '@maplibre/maplibre-react-native';
import {
  chooseMapProvider,
  type MapProviderName,
  maptilerStyleUrl,
  OSM_TILE_URL,
  type ProviderChoice,
} from '@sellwasl/config';
import type { ComponentProps } from 'react';
import type { Map } from '@maplibre/maplibre-react-native';

type MapStyle = ComponentProps<typeof Map>['mapStyle'];

/** Clé MapTiler du mobile (docs/maptiler.md), lue au moment de l'appel ; absente : OSM. */
export function maptilerKey(): string | undefined {
  return process.env.EXPO_PUBLIC_MAPTILER_KEY;
}

/** Tuiles OpenStreetMap (secours) dans un style MapLibre. */
export const OSM_STYLE: MapStyle = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

let choice: Promise<ProviderChoice> | null = null;
/** Clé vérifiée par `mapProvider` : celle des adresses MapTiler de la session. */
let activeKey: string | undefined;

/** Style de la carte pour le fournisseur choisi. */
export function mapStyleFor(provider: MapProviderName): MapStyle {
  return provider === 'maptiler' && activeKey ? maptilerStyleUrl(activeKey) : OSM_STYLE;
}

let osmHeader = false;

/**
 * Fournisseur de la session, vérifié une seule fois (requête au style MapTiler, sans en-tête
 * Origin : règle « ? » de la clé). Les tuiles OSM portent un User-Agent qui identifie
 * l'application (politique d'usage d'OpenStreetMap).
 */
export function mapProvider(key = maptilerKey()): Promise<ProviderChoice> {
  if (!osmHeader) {
    osmHeader = true;
    try {
      TransformRequestManager.addHeader({
        id: 'osm-user-agent',
        match: 'tile\\.openstreetmap\\.org',
        name: 'User-Agent',
        value: 'SellWasl/1.0 (application terrain de prévente et livraison)',
      });
    } catch {
      // Module natif absent (tests) : l'en-tête par défaut de MapLibre reste
    }
  }
  if (!choice) {
    activeKey = key?.trim() || undefined;
    choice = chooseMapProvider(key, async (url) => ({ status: (await fetch(url)).status }));
  }
  return choice;
}

/** Oublie le choix de la session (tests). */
export function resetMapProvider(): void {
  choice = null;
  activeKey = undefined;
}

/** Journal de développement : pourquoi la carte passe sur OSM. */
export function warnMap(message: string): void {
  if (__DEV__) console.warn(`[carte] ${message}`);
}
