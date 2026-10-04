import type { LatLng } from '@sellwasl/business-rules';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

type PermissionState = 'loading' | 'granted' | 'denied';

/** Position du téléphone, lue seulement quand l'application est ouverte (BR-JOU-09). */
export async function readPosition(): Promise<LatLng | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
    const fix =
      last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Autorisation « pendant l'utilisation » et position actuelle : tri des clients par distance,
 * visite sur place, nouveau client. Refusée : position nulle, l'application reste utilisable.
 */
export function useCurrentPosition() {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [status, setStatus] = useState<PermissionState>('loading');

  const refresh = useCallback(async (): Promise<LatLng | null> => {
    const { granted } = await Location.requestForegroundPermissionsAsync().catch(() => ({
      granted: false,
    }));
    setStatus(granted ? 'granted' : 'denied');
    if (!granted) return null;
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const next = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      setPosition(next);
      return next;
    } catch {
      const fallback = await readPosition();
      if (fallback) setPosition(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { position, status, refresh };
}
