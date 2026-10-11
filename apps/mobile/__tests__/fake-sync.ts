// Moteur de synchronisation simulé (phase 28) : les écrans lisent un état local choisi par le test,
// calculé par les vraies vues de @sellwasl/offline. Branché dans setup.ts.
import type { LocalState, OutboxOp } from '@sellwasl/offline';

export const fakeSync = {
  local: null as LocalState | null,
  ops: [] as OutboxOp[],
  online: true,
  ready: true,
  lastSyncAt: '2027-06-05T08:00:00.000Z' as string | null,
  lastFullSyncDate: '2027-06-05' as string | null,
  lastError: null as string | null,
  indicator: { state: 'SYNCED', pending: 0, failed: 0, conflicts: 0, unseenChanges: 0 } as Record<
    string,
    unknown
  >,
  syncNow: jest.fn(async () => ({ pushed: 0, pulled: 0 })),
  markSeen: jest.fn(async () => undefined),
};

export function useSync() {
  return { ...fakeSync, syncing: false };
}

export function useLocal<T>(view: (s: LocalState) => T) {
  if (!fakeSync.local) return { data: null, error: null, ready: fakeSync.ready };
  try {
    return { data: view(fakeSync.local), error: null, ready: fakeSync.ready };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e), ready: fakeSync.ready };
  }
}

export function SyncProvider({ children }: { children: unknown }) {
  return children;
}
