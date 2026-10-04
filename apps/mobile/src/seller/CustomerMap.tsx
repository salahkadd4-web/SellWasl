import type { LatLng } from '@sellwasl/business-rules';
import { colors } from '@sellwasl/config';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { ComponentProps } from 'react';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { FieldCustomer } from './customers';

/** Tuiles OpenStreetMap, fournisseur remplaçable (ARC-13). */
const OSM_STYLE: ComponentProps<typeof Map>['mapStyle'] = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Centre par défaut (Oran) quand ni le téléphone ni les clients n'ont de position. */
const DEFAULT_CENTER: LatLng = { latitude: 35.6971, longitude: -0.6308 };
const DEFAULT_ZOOM = 13;
const MARKER_RADIUS = 9;

/**
 * Carte des clients (UC-10) : rouge à visiter, vert visité (BR-VIS-06), regroupés quand ils sont
 * nombreux. Un appui sur un client le sélectionne.
 */
export function CustomerMap({
  customers,
  position,
  onSelect,
}: {
  customers: FieldCustomer[];
  position: LatLng | null;
  onSelect: (customer: FieldCustomer) => void;
}) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: customers
        .filter((c) => c.latitude != null && c.longitude != null)
        .map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.longitude!, c.latitude!] },
          properties: { id: c.id, visited: c.visited },
        })),
    }),
    [customers],
  );
  const first = customers.find((c) => c.latitude != null && c.longitude != null);
  const center: LatLng =
    position ??
    (first ? { latitude: first.latitude!, longitude: first.longitude! } : DEFAULT_CENTER);

  return (
    <Map style={styles.map} mapStyle={OSM_STYLE} logo={false} compass={false}>
      <Camera
        initialViewState={{ center: [center.longitude, center.latitude], zoom: DEFAULT_ZOOM }}
      />
      <GeoJSONSource
        id="customers"
        data={data}
        cluster
        clusterRadius={40}
        onPress={(event) => {
          const id = event.nativeEvent.features[0]?.properties?.id as string | undefined;
          const customer = id ? customers.find((c) => c.id === id) : undefined;
          if (customer) onSelect(customer);
        }}
      >
        <Layer
          id="clusters"
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': colors.deepBlue,
            'circle-opacity': 0.8,
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28],
          }}
        />
        <Layer
          id="customers-points"
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-color': [
              'case',
              ['get', 'visited'],
              colors.status.visited,
              colors.status.toVisit,
            ],
            'circle-radius': MARKER_RADIUS,
            'circle-stroke-width': 2,
            'circle-stroke-color': colors.background,
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
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
