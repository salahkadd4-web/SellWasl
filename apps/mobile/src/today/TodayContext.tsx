import { todayView } from '@sellwasl/offline';
import type { OperationType, TodayResponse } from '@sellwasl/validation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { ApiClientError } from '@/api/client';
import { setPositionSharing } from '@/device/heartbeat';
import { offlineStore } from '@/offline/engine';
import { phoneDate } from '@/offline/ids';
import { useLocal, useSync } from '@/offline/SyncProvider';
import { sendOperation } from '@/sync/operations';

export { phoneDate };

/** Démarrage sans réseau et sans synchronisation complète ce jour-là (décision phase 23). */
export const START_NEEDS_NETWORK =
  'Réseau nécessaire pour démarrer : aucune synchronisation aujourd’hui.';

interface TodayState {
  today: TodayResponse | null;
  loading: boolean;
  /** Données absentes du téléphone (première synchronisation pas encore faite). */
  error: string | null;
  /** Journée démarrée et pas encore clôturée : les actions sont permises (BR-JOU-05). */
  inProgress: boolean;
  /** Synchronise (bouton, geste « tirer pour rafraîchir »). */
  refresh: () => Promise<void>;
  /** Enregistre une action sur le téléphone (envoyée dès que possible) ; renvoie ses données. */
  act: <T = Record<string, unknown>>(type: OperationType, payload: object) => Promise<T>;
  /** Démarre la journée : synchronisation complète avec réseau ; sans réseau, si déjà faite ce jour-là. */
  startDay: (workdayId: string) => Promise<void>;
}

const TodayContext = createContext<TodayState | null>(null);

/**
 * Journée du vendeur, calculée sur le téléphone (phase 23) : données reçues + actions en file,
 * comme GET /me/today. Partagée par ses écrans.
 */
export function TodayProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState(phoneDate);
  const { online, ready, syncNow, lastFullSyncDate, local } = useSync();
  const { data: today } = useLocal((s) => todayView(s, date), [date]);

  // Le jour change pendant que l'application est ouverte : la journée suit la date du téléphone
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setDate(phoneDate());
    });
    return () => subscription.remove();
  }, []);

  const inProgress = today?.workday?.status === 'IN_PROGRESS';
  useEffect(() => {
    setPositionSharing(inProgress);
    return () => setPositionSharing(false);
  }, [inProgress]);

  const refresh = useCallback(async () => {
    setDate(phoneDate());
    await syncNow();
  }, [syncNow]);

  const act = useCallback(
    <T,>(type: OperationType, payload: object): Promise<T> =>
      sendOperation<T>(type, payload, today?.workday?.id ?? today?.openWorkday?.id ?? null),
    [today?.workday?.id, today?.openWorkday?.id],
  );

  const startDay = useCallback(
    async (workdayId: string) => {
      const day = phoneDate();
      if (online) await syncNow();
      // Réception complète réussie aujourd'hui (BR-JOU-04) ; sinon le réseau est obligatoire
      const synced = (await offlineStore.getMeta('lastFullSyncDate')) === day;
      if (!synced) throw new ApiClientError(0, 'NETWORK', START_NEEDS_NETWORK);
      await sendOperation('workday.start', {
        workdayId,
        date: day,
        ...(online ? {} : { offline: true }),
      });
    },
    [online, syncNow],
  );

  const empty = ready && !local?.settings;
  return (
    <TodayContext.Provider
      value={{
        today: empty ? null : today,
        loading: !ready,
        error: empty
          ? online
            ? 'Première synchronisation en cours…'
            : 'Réseau nécessaire pour la première synchronisation.'
          : lastFullSyncDate === null && !online
            ? 'Hors connexion.'
            : null,
        inProgress,
        refresh,
        act,
        startDay,
      }}
    >
      {children}
    </TodayContext.Provider>
  );
}

export function useToday(): TodayState {
  const value = useContext(TodayContext);
  if (!value) throw new Error('useToday doit être utilisé dans TodayProvider');
  return value;
}
