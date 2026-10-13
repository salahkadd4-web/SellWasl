import { Feather } from '@expo/vector-icons';
import type { LatLng } from '@sellwasl/business-rules';
import { colors, MAP_ATTRIBUTIONS, type MapProviderName, radius } from '@sellwasl/config';
import { Camera, GeoJSONSource, Images, Layer, Map } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { mapProvider, mapStyleFor, warnMap } from '@/map/provider';

/** Punaises MapPin (refonte mobile) : rouge à faire, verte faite. */
const PIN_IMAGES = {
  'pin-red': require('../../assets/map/pin-red.png'),
  'pin-green': require('../../assets/map/pin-green.png'),
};

/** Centre par défaut (Oran) quand ni le téléphone ni les clients n'ont de position. */
const DEFAULT_CENTER: LatLng = { latitude: 35.6971, longitude: -0.6308 };
const DEFAULT_ZOOM = 13;

/** Point de la carte : un client (vendeur) ou une livraison (livreur). */
export interface MapPoint {
  id: string;
  latitude: number | null;
  longitude: number | null;
  /** Vert : visite réalisée (vendeur) ou livraison faite (livreur) ; sinon rouge. */
  done: boolean;
}

/** Points placés sur la carte : sans position valide, un client n'y figure pas. */
export function placed<T extends MapPoint>(points: T[]): T[] {
  return points.filter(
    (p) =>
      p.latitude != null &&
      p.longitude != null &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180,
  );
}

/** Légende des punaises, toujours visible. */
export function MapPinLegend({ todo, done }: { todo: string; done: string }) {
  return (
    <View
      style={styles.legend}
      accessibilityLabel={`Punaise rouge : ${todo}. Punaise verte : ${done}.`}
    >
      <View style={styles.legendItem}>
        <Feather name="map-pin" size={18} color={colors.status.toVisit} />
        <Text style={styles.legendText}>{todo}</Text>
      </View>
      <View style={styles.legendItem}>
        <Feather name="map-pin" size={18} color={colors.status.visited} />
        <Text style={styles.legendText}>{done}</Text>
      </View>
    </View>
  );
}

/**
 * Carte des clients (UC-10) : punaise MapPin rouge (à faire) ou verte (faite) selon le statut
 * réel, regroupées quand elles sont nombreuses. Le cadrage initial ne change pas quand la liste
 * change (changement de filtre). Un appui sur une punaise la sélectionne.
 */
export function CustomerMap<T extends MapPoint>({
  points,
  position,
  onSelect,
}: {
  points: T[];
  position: LatLng | null;
  onSelect: (point: T) => void;
}) {
  const shown = useMemo(() => placed(points), [points]);
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: shown.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.longitude!, p.latitude!] },
        properties: { id: p.id, done: p.done },
      })),
    }),
    [shown],
  );
  const first = shown[0];
  const center: LatLng =
    position ??
    (first ? { latitude: first.latitude!, longitude: first.longitude! } : DEFAULT_CENTER);

  // Fond de carte : MapTiler, sinon OpenStreetMap (docs/maptiler.md)
  const [provider, setProvider] = useState<MapProviderName | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    void mapProvider().then(({ provider: chosen, reason }) => {
      if (!active) return;
      if (reason) warnMap(`OpenStreetMap utilisé : ${reason}.`);
      setProvider(chosen);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!provider)
    return (
      <View style={[styles.map, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );

  return (
    <View style={styles.map}>
      <Map
        style={styles.map}
        mapStyle={mapStyleFor(provider)}
        logo={false}
        compass={false}
        attribution={false}
        onDidFailLoadingMap={() => {
          if (provider === 'maptiler') {
            warnMap('style MapTiler en échec : bascule sur OpenStreetMap.');
            setProvider('osm');
          } else {
            warnMap('OpenStreetMap en échec aussi : fond de carte indisponible.');
            setUnavailable(true);
          }
        }}
      >
        <Camera
          initialViewState={{ center: [center.longitude, center.latitude], zoom: DEFAULT_ZOOM }}
        />
        <Images images={PIN_IMAGES} />
        <GeoJSONSource
          id="customers"
          data={data}
          cluster
          clusterRadius={40}
          onPress={(event) => {
            const id = event.nativeEvent.features[0]?.properties?.id as string | undefined;
            const point = id ? shown.find((p) => p.id === id) : undefined;
            if (point) onSelect(point);
          }}
        >
          <Layer
            id="clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': colors.deepBlue,
              'circle-opacity': 0.85,
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
            }}
          />
          <Layer
            id="clusters-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{ 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 }}
            paint={{ 'text-color': colors.background }}
          />
          <Layer
            id="customers-pins"
            type="symbol"
            filter={['!', ['has', 'point_count']]}
            layout={{
              'icon-image': ['case', ['get', 'done'], 'pin-green', 'pin-red'],
              'icon-size': 0.45,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
            }}
          />
        </GeoJSONSource>
        {position ? (
          <GeoJSONSource
            id="me"
            data={{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
              properties: {},
            }}
          >
            <Layer
              id="me-point"
              type="circle"
              paint={{
                'circle-color': colors.primary,
                'circle-radius': 7,
                'circle-stroke-width': 3,
                'circle-stroke-color': colors.background,
              }}
            />
          </GeoJSONSource>
        ) : null}
      </Map>
      <Text style={styles.attribution} accessibilityRole="text">
        {MAP_ATTRIBUTIONS[provider]}
      </Text>
      {unavailable ? (
        <Text style={styles.unavailable} accessibilityRole="alert">
          Fond de carte indisponible : les punaises restent affichées.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  attribution: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 10,
    color: colors.textDark,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  unavailable: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 28,
    textAlign: 'center',
    fontSize: 13,
    color: colors.textDark,
    backgroundColor: colors.background,
    padding: 8,
    borderRadius: radius.md,
  },
  legend: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendText: { fontSize: 13, fontWeight: '600', color: colors.textDark },
});
