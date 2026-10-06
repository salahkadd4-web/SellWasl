import { ApiClientError } from '@/api/client';
import { sendOperation } from '@/sync/operations';
import { offlineStore } from './engine';
import { phoneDate } from './ids';

/** Démarrage sans réseau et sans synchronisation complète ce jour-là (décision phase 23). */
export const START_NEEDS_NETWORK =
  'Réseau nécessaire pour démarrer : aucune synchronisation aujourd’hui.';

/**
 * Démarrage de la journée (BR-JOU-04) : avec réseau, synchronisation complète d'abord ; sans
 * réseau, permis seulement si une synchronisation complète a réussi ce jour-là.
 */
export async function startWorkday(
  workdayId: string,
  online: boolean,
  syncNow: () => Promise<unknown>,
): Promise<void> {
  const day = phoneDate();
  if (online) await syncNow();
  if ((await offlineStore.getMeta('lastFullSyncDate')) !== day)
    throw new ApiClientError(0, 'NETWORK', START_NEEDS_NETWORK);
  await sendOperation('workday.start', {
    workdayId,
    date: day,
    ...(online ? {} : { offline: true }),
  });
}
