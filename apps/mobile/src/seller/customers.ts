import { distanceMeters, type LatLng } from '@sellwasl/business-rules';
import type { CustomerDto, Page } from '@sellwasl/validation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { request } from '@/api/client';
import { useToday } from '@/today/TodayContext';
import { errorMessage } from './format';

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
  /** Client du jour (sinon : hors programme). */
  inDay: boolean;
  /** Visite terminée aujourd'hui : marqueur vert (BR-VIS-06). */
  visited: boolean;
  distanceM: number | null;
}

export type CustomerScope = 'day' | 'sector';

/** Tous les clients du secteur, page par page (limités au secteur du vendeur par le serveur). */
async function sectorCustomers(): Promise<CustomerDto[]> {
  const all: CustomerDto[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<CustomerDto> = await request<Page<CustomerDto>>(
      `/customers?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    all.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Clients du jour ou de tout le secteur, triés du plus proche au plus loin (BR-VIS-10), par nom
 * sans position du téléphone (UC-10).
 */
export function useFieldCustomers(scope: CustomerScope, position: LatLng | null) {
  const { today } = useToday();
  const [sector, setSector] = useState<CustomerDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSector = useCallback(async () => {
    setLoading(true);
    try {
      setSector(await sectorCustomers());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scope === 'sector' && !sector) void loadSector();
  }, [scope, sector, loadSector]);

  const customers = useMemo(() => {
    const dayIds = new Set(today?.day.customers.map((c) => c.id) ?? []);
    const visited = new Set(
      (today?.visits ?? []).filter((v) => v.status === 'COMPLETED').map((v) => v.customerId),
    );
    const source =
      scope === 'day'
        ? (today?.day.customers ?? [])
        : (sector ?? []).filter((c) => c.status === 'ACTIVE');
    const rows: FieldCustomer[] = source.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      address: c.address,
      phone: c.phone,
      latitude: c.latitude,
      longitude: c.longitude,
      debtAmount: c.debtAmount,
      inDay: dayIds.has(c.id),
      visited: visited.has(c.id),
      distanceM:
        position && c.latitude != null && c.longitude != null
          ? distanceMeters(position, { latitude: c.latitude, longitude: c.longitude })
          : null,
    }));
    return rows.sort((a, b) => {
      if (a.distanceM !== null && b.distanceM !== null) return a.distanceM - b.distanceM;
      if (a.distanceM !== null) return -1;
      if (b.distanceM !== null) return 1;
      return a.name.localeCompare(b.name, 'fr');
    });
  }, [scope, sector, today, position]);

  return { customers, loading, error, reload: loadSector };
}

/** Itinéraire dans Google Maps (UC-10), ou dans le navigateur s'il n'est pas installé. */
export async function openDirections(latitude: number, longitude: number): Promise<void> {
  try {
    await Linking.openURL(`google.navigation:q=${latitude},${longitude}`);
  } catch {
    await Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    ).catch(() => Alert.alert('Itinéraire', "Impossible d'ouvrir une application de cartes."));
  }
}

/** Appel du client depuis sa fiche (UC-11). */
export function callCustomer(phone: string): void {
  Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() =>
    Alert.alert('Appeler', "Impossible d'ouvrir le téléphone."),
  );
}
