import type { OutboxOp } from './types';

/** Indicateur permanent du téléphone (BR-SYN-06). */
export interface SyncIndicator {
  state: 'SYNCED' | 'PENDING' | 'ERROR';
  /** Opérations pas encore appliquées par le serveur. */
  pending: number;
  /** Refus pas encore vus. */
  conflicts: number;
  /** Opérations transformées à la réception, pas encore vues (BR-SYN-05). */
  unseenChanges: number;
}

/**
 * « Synchronisé », « N opérations en attente » ou « erreur ». Hors ligne, l'échec du dernier essai
 * n'est pas une erreur : les opérations attendent le réseau.
 */
export function syncStatus(
  ops: Pick<OutboxOp, 'status' | 'seen' | 'changes'>[],
  lastError: string | null,
  online: boolean,
): SyncIndicator {
  const pending = ops.filter(
    (o) => o.status === 'PENDING' || o.status === 'SYNCING' || o.status === 'FAILED',
  ).length;
  const conflicts = ops.filter((o) => o.status === 'CONFLICT' && !o.seen).length;
  const unseenChanges = ops.filter(
    (o) => o.status === 'SYNCED' && !o.seen && o.changes.length > 0,
  ).length;
  const state =
    conflicts > 0 || (online && lastError !== null) ? 'ERROR' : pending > 0 ? 'PENDING' : 'SYNCED';
  return { state, pending, conflicts, unseenChanges };
}
