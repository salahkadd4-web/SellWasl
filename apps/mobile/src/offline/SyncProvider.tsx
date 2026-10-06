import NetInfo from '@react-native-community/netinfo';
import {
  applyOps,
  type LocalState,
  loadState,
  type OutboxOp,
  type SyncIndicator,
  type SyncReport,
  syncStatus,
} from '@sellwasl/offline';
import {
  createContext,
  type DependencyList,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { migrateLegacy, offlineEngine, offlineStore } from './engine';

interface SyncState {
  /** Base locale lue (au moins une fois). */
  ready: boolean;
  /** Vue locale : données reçues + effet des opérations en file. */
  local: LocalState | null;
  ops: OutboxOp[];
  indicator: SyncIndicator;
  online: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  /** Date (téléphone) de la dernière réception complète : démarrage hors connexion permis ce jour-là. */
  lastFullSyncDate: string | null;
  lastError: string | null;
  /** Bouton « Synchroniser » : ignore les délais entre essais. */
  syncNow: () => Promise<SyncReport>;
  markSeen: (opIds: string[]) => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

/**
 * Synchronisation du téléphone (BR-SYN-01, BR-SYN-06, architecture §10.4) : au retour du réseau,
 * au retour dans l'application, après chaque action et sur le bouton ; jamais en arrière-plan.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<LocalState | null>(null);
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [meta, setMeta] = useState({
    lastSyncAt: null as string | null,
    lastFullSyncDate: null as string | null,
    lastError: null as string | null,
  });
  const wasOnline = useRef(true);

  const reloadOps = useCallback(async () => {
    const [outbox, lastSyncAt, lastFullSyncDate, lastError] = await Promise.all([
      offlineStore.outbox(),
      offlineStore.getMeta('lastSyncAt'),
      offlineStore.getMeta('lastFullSyncDate'),
      offlineStore.getMeta('lastError'),
    ]);
    setOps(outbox);
    setMeta({ lastSyncAt, lastFullSyncDate, lastError });
  }, []);

  const reloadBase = useCallback(async () => {
    setBase(loadState(await offlineStore.allRows()));
  }, []);

  const sync = useCallback(async (force = false) => {
    setSyncing(true);
    try {
      return await offlineEngine.sync({ force });
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await migrateLegacy();
      if (!alive) return;
      await Promise.all([reloadBase(), reloadOps()]);
      void sync();
    })();
    const unsubscribe = offlineEngine.onChange((what) => {
      if (what === 'data') void reloadBase();
      void reloadOps();
    });
    const net = NetInfo.addEventListener((s) => {
      const now = s.isConnected === true && s.isInternetReachable !== false;
      setOnline(now);
      if (now && !wasOnline.current) void sync();
      wasOnline.current = now;
    });
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void sync();
    });
    return () => {
      alive = false;
      unsubscribe();
      net();
      app.remove();
    };
  }, [reloadBase, reloadOps, sync]);

  // Nouvel essai programmé après une erreur (5 s, 15 s, 60 s, puis 5 min), application ouverte
  useEffect(() => {
    const next = ops
      .filter((o) => o.status === 'FAILED' && o.nextAttemptAt)
      .map((o) => new Date(o.nextAttemptAt!).getTime())
      .sort((a, b) => a - b)[0];
    if (next === undefined || !online) return;
    const timer = setTimeout(() => void sync(), Math.max(1000, next - Date.now()));
    return () => clearTimeout(timer);
  }, [ops, online, sync]);

  const local = useMemo(() => (base ? applyOps(base, ops) : null), [base, ops]);
  const value: SyncState = {
    ready: base !== null,
    local,
    ops,
    indicator: syncStatus(ops, meta.lastError, online),
    online,
    syncing,
    ...meta,
    syncNow: () => sync(true),
    markSeen: (opIds) => offlineEngine.markSeen(opIds),
  };
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync doit être utilisé dans SyncProvider');
  return value;
}

/**
 * Écran calculé sur la vue locale (spec phase 23 §4.4) ; `error` porte le message d'une vue
 * impossible (données absentes : synchroniser).
 */
export function useLocal<T>(
  view: (s: LocalState) => T,
  deps: DependencyList,
): { data: T | null; error: string | null; ready: boolean } {
  const { local, ready } = useSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const compute = useCallback(view, deps);
  return useMemo(() => {
    if (!local) return { data: null, error: null, ready };
    try {
      return { data: compute(local), error: null, ready };
    } catch (e) {
      return { data: null, error: e instanceof Error ? e.message : String(e), ready };
    }
  }, [local, compute, ready]);
}
