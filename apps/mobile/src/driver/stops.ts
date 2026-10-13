import { distanceMeters, type LatLng } from '@sellwasl/business-rules';
import { driverRouteView } from '@sellwasl/offline';
import type { DriverDeliveryDto } from '@sellwasl/validation';
import { useMemo } from 'react';
import { phoneDate } from '@/offline/ids';
import { useLocal } from '@/offline/SyncProvider';

/** Arrêt de la tournée : la livraison, sa distance et si elle est faite (livrée, partielle, échec). */
export type Stop = DriverDeliveryDto & { distanceM: number | null; done: boolean };

export const RESULT_LABELS: Record<string, string> = {
  DELIVERED: 'Livrée',
  PARTIAL: 'Livrée en partie',
  FAILED: 'Échec',
};

/**
 * Tournée du livreur (UC-31, BR-LIV-01), gardée sur le téléphone (phase 23) : à faire d'abord,
 * du plus proche au plus loin ; les livraisons faites ensuite.
 */
export function useStops(position: LatLng | null) {
  const { data: route, error } = useLocal((s) => driverRouteView(s, phoneDate()), []);
  const stops = useMemo<Stop[]>(
    () =>
      (route?.deliveries ?? [])
        .map((d) => ({
          ...d,
          done: d.status !== 'OUT_FOR_DELIVERY',
          distanceM:
            position && d.customer.latitude != null && d.customer.longitude != null
              ? Math.round(
                  distanceMeters(position, {
                    latitude: d.customer.latitude,
                    longitude: d.customer.longitude,
                  }),
                )
              : null,
        }))
        .sort(
          (a, b) =>
            Number(a.done) - Number(b.done) ||
            (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
            a.customer.name.localeCompare(b.customer.name),
        ),
    [route, position],
  );
  return { route, stops, error };
}
