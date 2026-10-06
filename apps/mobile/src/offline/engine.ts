import { SyncEngine } from '@sellwasl/offline';
import type { SyncOperationInput } from '@sellwasl/validation';
import { secureStorage } from '@/auth/storage';
import { newId, phoneDate } from './ids';
import { SqliteStore } from './sqlite-store';
import { httpTransport } from './transport';

/** Base locale et moteur uniques du téléphone (spec phase 23 §5). */
export const offlineStore = new SqliteStore();
export const offlineEngine = new SyncEngine({
  store: offlineStore,
  transport: httpTransport,
  newId: () => newId(),
  today: () => phoneDate(),
});

let migrated: Promise<void> | null = null;

/**
 * Reprise de l'envoi direct de la phase 15 : le numéro d'ordre continue, et l'opération partie
 * sans réponse entre dans la file avec son opId (le serveur ne l'appliquera qu'une fois).
 */
export function migrateLegacy(): Promise<void> {
  migrated ??= (async () => {
    if ((await offlineStore.getMeta('deviceSeq')) === null) {
      const legacySeq = await secureStorage.getNumber('deviceSeq');
      const raw = await secureStorage.getPendingOp();
      const pending = raw ? (JSON.parse(raw) as SyncOperationInput) : null;
      await offlineStore.setMeta('deviceSeq', String(legacySeq));
      if (pending)
        await offlineStore.enqueue({
          opId: pending.opId,
          deviceSeq: pending.deviceSeq,
          type: pending.type as never,
          payload: (pending.payload ?? {}) as Record<string, unknown>,
          workdayId: pending.workdayId ?? null,
          occurredAt: pending.occurredAt,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: null,
          error: null,
          result: null,
          changes: [],
          seen: true,
          reflected: false,
        });
    }
    await secureStorage.setPendingOp(null);
  })();
  return migrated;
}

/** Opérations pas encore appliquées par le serveur (déconnexion refusée tant qu'il en reste). */
export async function unsentCount(): Promise<number> {
  await migrateLegacy();
  return (await offlineStore.outbox()).filter((o) =>
    ['PENDING', 'SYNCING', 'FAILED'].includes(o.status),
  ).length;
}

/** Changement d'utilisateur ou nouvelle association : la base locale repart de zéro. */
export async function wipeOffline(): Promise<void> {
  await offlineStore.wipe();
  migrated = null;
}
