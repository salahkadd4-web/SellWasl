import { distanceMeters, type LatLng } from '@sellwasl/business-rules';
import { customersView } from '@sellwasl/offline';
import { useMemo } from 'react';
import { Alert, Linking } from 'react-native';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { useToday } from '@/today/TodayContext';

/** Client tel que l'affichent la liste et la carte du vendeur. */
export interface FieldCustomer {
  id: string;
  code: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  debtAmount: number;
  /** Type de client (Détail, Gros…), quand il est connu sur le téléphone. */
  typeName: string | null;
  /** Client du jour (sinon : hors programme). */
  inDay: boolean;
  /** Visite terminée aujourd'hui : punaise verte (BR-VIS-06). */
  visited: boolean;
  distanceM: number | null;
}

export type CustomerScope = 'day' | 'sector';
export type CustomerStatusFilter = 'all' | 'toVisit' | 'visited' | 'outOfProgram';

/** Du plus proche au plus loin (BR-VIS-10), par nom sans position du téléphone (UC-10). */
function byDistance(a: FieldCustomer, b: FieldCustomer): number {
  if (a.distanceM !== null && b.distanceM !== null) return a.distanceM - b.distanceM;
  if (a.distanceM !== null) return -1;
  if (b.distanceM !== null) return 1;
  return a.name.localeCompare(b.name, 'fr');
}

/**
 * Clients du jour et de tout le secteur (actifs), calculés ensemble pour afficher les deux
 * compteurs (refonte mobile) ; triés par distance.
 */
export function useCustomerLists(position: LatLng | null) {
  const { today } = useToday();
  // Clients du secteur gardés sur le téléphone (phase 23), dette à jour des encaissements en file
  const { data: sector, error } = useLocal(customersView, []);
  const { syncing, syncNow } = useSync();

  const lists = useMemo(() => {
    const dayIds = new Set(today?.day.customers.map((c) => c.id) ?? []);
    const visited = new Set(
      (today?.visits ?? []).filter((v) => v.status === 'COMPLETED').map((v) => v.customerId),
    );
    const types = new Map((sector ?? []).map((c) => [c.id, c.customerType.name]));
    const toRow = (c: {
      id: string;
      code: string | null;
      name: string;
      address: string | null;
      phone: string | null;
      latitude: number | null;
      longitude: number | null;
      debtAmount: number;
    }): FieldCustomer => ({
      id: c.id,
      code: c.code,
      name: c.name,
      address: c.address,
      phone: c.phone,
      latitude: c.latitude,
      longitude: c.longitude,
      debtAmount: c.debtAmount,
      typeName: types.get(c.id) || null,
      inDay: dayIds.has(c.id),
      visited: visited.has(c.id),
      distanceM:
        position && c.latitude != null && c.longitude != null
          ? distanceMeters(position, { latitude: c.latitude, longitude: c.longitude })
          : null,
    });
    return {
      day: (today?.day.customers ?? []).map(toRow).sort(byDistance),
      sector: (sector ?? [])
        .filter((c) => c.status === 'ACTIVE')
        .map(toRow)
        .sort(byDistance),
    };
  }, [sector, today, position]);

  return { ...lists, loading: syncing, error, reload: syncNow };
}

/** Recherche (nom, code, adresse, téléphone) et filtre d'état, combinés. */
export function filterCustomers(
  customers: FieldCustomer[],
  query: string,
  status: CustomerStatusFilter,
): FieldCustomer[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  return customers.filter((c) => {
    if (status === 'toVisit' && c.visited) return false;
    if (status === 'visited' && !c.visited) return false;
    if (status === 'outOfProgram' && c.inDay) return false;
    if (!q) return true;
    if ([c.name, c.code, c.address].some((v) => v?.toLowerCase().includes(q))) return true;
    return digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits);
  });
}

/** Destination de l'itinéraire : position du client, sinon son adresse. */
export interface Destination {
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
}

/** Une adresse trop courte (« Oran ») mènerait n'importe où : elle n'est pas utilisée. */
const MIN_ADDRESS_LENGTH = 8;

/**
 * Lien de navigation Google Maps (depuis la position actuelle) ; null sans position ni adresse
 * assez précise.
 */
export function directionsUrl(target: Destination): string | null {
  const base = 'https://www.google.com/maps/dir/?api=1&destination=';
  const { latitude, longitude } = target;
  if (
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  )
    return `${base}${latitude},${longitude}&travelmode=driving`;
  const address = target.address?.trim();
  if (address && address.length >= MIN_ADDRESS_LENGTH)
    return `${base}${encodeURIComponent(address)}&travelmode=driving`;
  return null;
}

/** Itinéraire dans Google Maps (UC-10), ou dans le navigateur s'il n'est pas installé. */
export async function openDirectionsTo(target: Destination): Promise<void> {
  const url = directionsUrl(target);
  if (!url) {
    Alert.alert('Localiser', "Ce client n'a ni position ni adresse précise.");
    return;
  }
  await Linking.openURL(url).catch(() =>
    Alert.alert('Localiser', "Impossible d'ouvrir une application de cartes."),
  );
}

/** Itinéraire vers une position connue. */
export function openDirections(latitude: number, longitude: number): Promise<void> {
  return openDirectionsTo({ latitude, longitude });
}

/** Appel du client depuis sa fiche (UC-11). */
export function callCustomer(phone: string): void {
  Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() =>
    Alert.alert('Appeler', "Impossible d'ouvrir le téléphone."),
  );
}
