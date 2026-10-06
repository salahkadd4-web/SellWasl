import type { OperationType, TodayResponse } from '@sellwasl/validation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { ApiClientError, request } from '@/api/client';
import { setPositionSharing } from '@/device/heartbeat';
import { sendOperation } from '@/sync/operations';

import { phoneDate } from '@/offline/ids';

export { phoneDate };

interface TodayState {
  today: TodayResponse | null;
  loading: boolean;
  error: string | null;
  /** Journée démarrée et pas encore clôturée : les actions sont permises (BR-JOU-05). */
  inProgress: boolean;
  refresh: () => Promise<void>;
  /** Envoie une action puis recharge la journée ; renvoie le résultat du serveur. */
  act: <T = Record<string, unknown>>(type: OperationType, payload: object) => Promise<T>;
}

const TodayContext = createContext<TodayState | null>(null);

/** Journée du vendeur (GET /me/today), partagée par ses écrans. */
export function TodayProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setToday(await request<TodayResponse>(`/me/today?date=${phoneDate()}`));
      setError(null);
    } catch (e) {
      // Hors connexion : la dernière journée chargée reste affichée
      setError(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const inProgress = today?.workday?.status === 'IN_PROGRESS';
  useEffect(() => {
    setPositionSharing(inProgress);
    return () => setPositionSharing(false);
  }, [inProgress]);

  const act = useCallback(
    async <T,>(type: OperationType, payload: object): Promise<T> => {
      try {
        return await sendOperation<T>(type, payload, today?.workday?.id ?? null);
      } finally {
        void refresh();
      }
    },
    [refresh, today?.workday?.id],
  );

  return (
    <TodayContext.Provider value={{ today, loading, error, inProgress, refresh, act }}>
      {children}
    </TodayContext.Provider>
  );
}

export function useToday(): TodayState {
  const value = useContext(TodayContext);
  if (!value) throw new Error('useToday doit être utilisé dans TodayProvider');
  return value;
}
