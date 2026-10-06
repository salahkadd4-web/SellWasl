'use client';

import 'leaflet/dist/leaflet.css';
import type { SupervisorMapDto } from '@sellwasl/validation';
import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { plainTooltip, TERRITORY_COLORS } from '@/components/territory-map';

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>';
const VISITED = '#16a34a';
const TO_VISIT = '#dc2626';
const TEAM = '#001850';

type Polygon = { type: 'Polygon'; coordinates: number[][][] };

/** Carte du superviseur (UC-63), en lecture seule : parties, clients du jour, équipes. */
export default function SupervisorMap({ data }: { data: SupervisorMapDto }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;
    map.current = L.map(container.current, { center: [35.7, -0.63], zoom: 12 });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    if (!group || !map.current) return;
    group.clearLayers();
    const bounds = L.latLngBounds([]);
    data.parts.forEach((p, i) => {
      const polygon = p.geojson as Polygon;
      if (polygon?.type !== 'Polygon') return;
      const color = TERRITORY_COLORS[i % TERRITORY_COLORS.length]!;
      const shape = L.polygon(
        polygon.coordinates[0]!.map(([lng, lat]) => [lat!, lng!] as L.LatLngTuple),
        { color, weight: 2, fillOpacity: 0.08 },
      )
        .bindTooltip(plainTooltip(`${p.territory} · ${p.name}`))
        .addTo(group);
      bounds.extend(shape.getBounds());
    });
    for (const c of data.customers) {
      L.circleMarker([c.latitude, c.longitude], {
        radius: 6,
        color: c.visited ? VISITED : TO_VISIT,
        fillColor: c.visited ? VISITED : TO_VISIT,
        fillOpacity: 0.8,
        weight: 1,
      })
        .bindTooltip(plainTooltip(`${c.name} · ${c.visited ? 'visité' : 'à visiter'}`))
        .addTo(group);
      bounds.extend([c.latitude, c.longitude]);
    }
    for (const p of data.positions) {
      L.circleMarker([p.latitude, p.longitude], {
        radius: 9,
        color: '#ffffff',
        fillColor: TEAM,
        fillOpacity: 1,
        weight: 2,
      })
        .bindTooltip(plainTooltip(`${p.name} · ${new Date(p.at).toLocaleTimeString('fr-DZ')}`))
        .addTo(group);
      bounds.extend([p.latitude, p.longitude]);
    }
    // Cadrage au premier affichage seulement : le rafraîchissement ne déplace pas la carte
    if (!fitted.current && bounds.isValid()) {
      map.current.fitBounds(bounds, { padding: [24, 24] });
      fitted.current = true;
    }
  }, [data]);

  return (
    <div
      ref={container}
      className="h-[calc(100dvh-14rem)] min-h-80 w-full rounded-xl border border-border sm:h-[420px]"
    />
  );
}
