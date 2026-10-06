'use client';

import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { CustomerPosition, FieldPosition, TerritoryDto } from '@sellwasl/validation';
import L from 'leaflet';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/** Fond de carte : OpenStreetMap par défaut, ou le fournisseur choisi (architecture §12). */
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>';

export const TERRITORY_COLORS = [
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
  '#be185d',
  '#65a30d',
  '#4f46e5',
  '#b45309',
  '#0f766e',
];
const OUT_OF_PART = '#dc2626';

/**
 * Info-bulle en texte brut : Leaflet lit une chaîne comme du HTML, et les noms (clients, parties,
 * utilisateurs) sont saisis par les équipes. Une ligne par élément de `lines`.
 */
export function plainTooltip(...lines: string[]): HTMLElement {
  const el = document.createElement('span');
  lines.forEach((line, i) => {
    if (i > 0) el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(line));
  });
  return el;
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

type Polygon = { type: 'Polygon'; coordinates: number[][][] };

/** GeoJSON (longitude, latitude) → Leaflet (latitude, longitude) : la seule conversion. */
function toLatLngs(polygon: Polygon): L.LatLngExpression[] {
  return polygon.coordinates[0]!.slice(0, -1).map(([lng, lat]) => [lat!, lng!]);
}
function toGeoJson(layer: L.Polygon): Polygon {
  return (layer.toGeoJSON() as GeoJSON.Feature<GeoJSON.Polygon>).geometry as Polygon;
}

export interface TerritoryMapHandle {
  /** Dessiner la partie `number` du secteur en cours de modification. */
  drawPart(number: number): void;
  removePart(number: number): void;
  /** Parties du secteur en cours de modification, telles que dessinées. */
  editedParts(): { number: number; geojson: Polygon }[];
  /** Tracer un rectangle pour sélectionner des clients. */
  startSelection(): void;
  fitTo(territoryId: string | null): void;
  /** Abandonne un dessin commencé. */
  cancelDrawing(): void;
}

interface Props {
  territories: TerritoryDto[];
  customers: CustomerPosition[];
  fieldUsers: FieldPosition[];
  selectedId: string | null;
  /** Secteur dont les parties sont en cours de modification. */
  editingId: string | null;
  showCustomers: boolean;
  onCustomerClick: (customer: CustomerPosition) => void;
  onSelection: (customerIds: string[]) => void;
  onPartsEdited: (numbers: number[]) => void;
}

/** Carte du superviseur : secteurs, parties, clients et équipes (UC-50, UC-53, UC-57). */
export const TerritoryMap = forwardRef<TerritoryMapHandle, Props>(
  function TerritoryMap(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const map = useRef<L.Map | null>(null);
    const layers = useRef<{ parts: L.LayerGroup; customers: L.LayerGroup; field: L.LayerGroup }>(
      null,
    );
    const edited = useRef(new Map<number, L.Polygon>());
    const drawing = useRef<{ kind: 'part'; number: number } | { kind: 'select' } | null>(null);
    const latest = useRef(props);
    latest.current = props;

    // Création de la carte, une seule fois. Geoman lit la variable globale L et ne s'attache
    // qu'aux cartes créées après son chargement : il est donc chargé d'abord.
    const [ready, setReady] = useState(false);
    useEffect(() => {
      let instance: L.Map | null = null;
      let cancelled = false;
      (window as unknown as { L: typeof L }).L = L;
      void import('@geoman-io/leaflet-geoman-free').then(() => {
        if (cancelled || !container.current) return;
        instance = L.map(container.current, { center: [36.3, 3.5], zoom: 6 });
        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(instance);
        layers.current = {
          parts: L.layerGroup().addTo(instance),
          customers: L.layerGroup().addTo(instance),
          field: L.layerGroup().addTo(instance),
        };
        instance.pm.setLang('fr');
        instance.pm.setGlobalOptions({
          snappable: true,
          snapDistance: 15,
          allowSelfIntersection: false,
        });
        instance.on('pm:create', (e) => {
          const current = drawing.current;
          drawing.current = null;
          if (current?.kind === 'part' && e.layer instanceof L.Polygon) {
            edited.current.get(current.number)?.remove();
            const layer = e.layer;
            layer.setStyle({ color: '#001850', weight: 3, fillOpacity: 0.15 });
            layer.bindTooltip(`Partie ${current.number}`, { permanent: true, direction: 'center' });
            layer.pm.enable({ allowSelfIntersection: false });
            edited.current.set(current.number, layer);
            latest.current.onPartsEdited([...edited.current.keys()]);
          } else if (current?.kind === 'select' && e.layer instanceof L.Rectangle) {
            const bounds = e.layer.getBounds();
            e.layer.remove();
            latest.current.onSelection(
              latest.current.customers
                .filter((c) => bounds.contains([c.latitude, c.longitude]))
                .map((c) => c.id),
            );
          } else {
            e.layer.remove();
          }
        });
        map.current = instance;
        setReady(true);
      });
      return () => {
        cancelled = true;
        instance?.remove();
        map.current = null;
        layers.current = null;
      };
    }, []);

    const colorOf = (territoryId: string | null) => {
      const index = props.territories.findIndex((t) => t.id === territoryId);
      return index < 0 ? '#64748b' : TERRITORY_COLORS[index % TERRITORY_COLORS.length]!;
    };

    // Parties des secteurs (hors secteur en cours de modification)
    useEffect(() => {
      const group = layers.current?.parts;
      if (!group) return;
      group.clearLayers();
      for (const t of props.territories) {
        if (t.id === props.editingId) continue;
        const color = colorOf(t.id);
        const selected = t.id === props.selectedId;
        for (const p of t.parts) {
          L.polygon(toLatLngs(p.geojson), {
            color,
            weight: selected ? 3 : 1.5,
            fillOpacity: selected ? 0.18 : 0.08,
            dashArray: t.isActive ? undefined : '6 6',
          })
            .bindTooltip(plainTooltip(`${t.code} · ${p.name} : ${p.customerCount} client(s)`), {
              sticky: true,
            })
            .addTo(group);
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, props.territories, props.selectedId, props.editingId]);

    // Parties modifiables du secteur en cours de modification
    useEffect(() => {
      const instance = map.current;
      instance?.pm?.disableDraw();
      drawing.current = null;
      for (const layer of edited.current.values()) layer.remove();
      edited.current.clear();
      if (!instance || !props.editingId) return;
      const territory = props.territories.find((t) => t.id === props.editingId);
      for (const p of territory?.parts ?? []) {
        const layer = L.polygon(toLatLngs(p.geojson), {
          color: '#001850',
          weight: 3,
          fillOpacity: 0.15,
        })
          .bindTooltip(plainTooltip(p.name), { permanent: true, direction: 'center' })
          .addTo(instance);
        edited.current.set(p.number, layer);
        layer.pm.enable({ allowSelfIntersection: false });
      }
      props.onPartsEdited([...edited.current.keys()]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, props.editingId]);

    // Clients : couleur du secteur, rouge hors partie, contour épais si la partie est forcée
    useEffect(() => {
      const group = layers.current?.customers;
      if (!group) return;
      group.clearLayers();
      if (!props.showCustomers) return;
      for (const c of props.customers) {
        L.circleMarker([c.latitude, c.longitude], {
          radius: 5,
          color: c.isPartForced ? '#001850' : '#ffffff',
          weight: c.isPartForced ? 2.5 : 1,
          fillColor: c.partId ? colorOf(c.territoryId) : OUT_OF_PART,
          fillOpacity: 0.95,
        })
          .bindTooltip(
            plainTooltip(
              `${c.name}${c.code ? ` (${c.code})` : ''}${c.partId ? '' : ' · hors partie'}`,
            ),
          )
          .on('click', () => latest.current.onCustomerClick(c))
          .addTo(group);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, props.customers, props.territories, props.showCustomers]);

    // Vendeurs et livreurs : dernière position connue
    useEffect(() => {
      const group = layers.current?.field;
      if (!group) return;
      group.clearLayers();
      for (const f of props.fieldUsers) {
        L.marker([f.latitude, f.longitude], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:#001850;color:#fff;border:2px solid #fff;border-radius:9999px;padding:2px 6px;font:600 11px sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.4)">${escapeHtml(f.code)}</div>`,
            iconSize: [40, 20],
            iconAnchor: [20, 10],
          }),
        })
          .bindTooltip(
            plainTooltip(
              `${f.name} · ${f.role}`,
              `${new Date(f.at).toLocaleTimeString('fr-DZ', { hour: '2-digit', minute: '2-digit' })}${f.batteryLevel !== null ? ` · batterie ${f.batteryLevel} %` : ''}`,
            ),
          )
          .addTo(group);
      }
    }, [ready, props.fieldUsers]);

    // Premier cadrage sur l'ensemble des parties et des clients
    const framed = useRef(false);
    useEffect(() => {
      if (framed.current || !map.current) return;
      const points: L.LatLngExpression[] = [
        ...props.territories.flatMap((t) => t.parts.flatMap((p) => toLatLngs(p.geojson))),
        ...props.customers.map((c) => [c.latitude, c.longitude] as L.LatLngExpression),
      ];
      if (points.length > 0) {
        map.current.fitBounds(L.latLngBounds(points), { padding: [20, 20] });
        framed.current = true;
      }
    }, [ready, props.territories, props.customers]);

    useImperativeHandle(ref, () => ({
      drawPart(number) {
        if (!map.current?.pm) return;
        drawing.current = { kind: 'part', number };
        map.current.pm.enableDraw('Polygon', { snappable: true });
      },
      removePart(number) {
        edited.current.get(number)?.remove();
        edited.current.delete(number);
        latest.current.onPartsEdited([...edited.current.keys()]);
      },
      editedParts() {
        return [...edited.current.entries()]
          .sort(([a], [b]) => a - b)
          .map(([number, layer]) => ({ number, geojson: toGeoJson(layer) }));
      },
      startSelection() {
        if (!map.current?.pm) return;
        drawing.current = { kind: 'select' };
        map.current.pm.enableDraw('Rectangle');
      },
      cancelDrawing() {
        drawing.current = null;
        map.current?.pm?.disableDraw();
      },
      fitTo(territoryId) {
        const territory = latest.current.territories.find((t) => t.id === territoryId);
        const points = territory?.parts.flatMap((p) => toLatLngs(p.geojson)) ?? [];
        if (map.current && points.length > 0)
          map.current.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
      },
    }));

    // `isolate` : les calques Leaflet (z-index 400 et plus) restent sous les fenêtres
    return <div ref={container} className="isolate h-full min-h-[420px] w-full rounded-2xl" />;
  },
);
