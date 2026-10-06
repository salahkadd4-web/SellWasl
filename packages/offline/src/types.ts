import type {
  OfflineKind,
  OperationType,
  PulledRow,
  SyncChange,
  SyncOperationInput,
  SyncPullResponse,
  SyncPushResponse,
} from '@sellwasl/validation';

/**
 * État d'une opération du téléphone (spec phase 23 §4.2) :
 * PENDING en attente, SYNCING en cours d'envoi, SYNCED appliquée par le serveur, FAILED erreur
 * réseau ou serveur (nouvel essai plus tard), CONFLICT refusée par le serveur (motif gardé).
 */
export type OpStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

export interface OutboxOp {
  opId: string;
  deviceSeq: number;
  type: OperationType;
  payload: Record<string, unknown>;
  workdayId: string | null;
  occurredAt: string;
  status: OpStatus;
  attempts: number;
  /** FAILED : pas de nouvel essai automatique avant cette heure (ISO). */
  nextAttemptAt: string | null;
  error: { code: string; message: string } | null;
  result: Record<string, unknown> | null;
  /** Transformations faites par le serveur à la réception (BR-SYN-05). */
  changes: SyncChange[];
  /** L'utilisateur a vu le refus ou les changements. */
  seen: boolean;
  /** Une réception complète a suivi l'application : son effet est dans les données reçues. */
  reflected: boolean;
}

export type MetaKey =
  'cursor' | 'scope' | 'lastFullSyncDate' | 'deviceSeq' | 'lastSyncAt' | 'lastError';

export interface StoredRow {
  id: string;
  data: unknown;
}

/** Stockage du téléphone : SQLite en vrai, mémoire dans les tests. */
export interface OfflineStore {
  /** Écrit une réception, en une transaction : sortes remplacées vidées, suppressions, lignes. */
  applyPull(rows: PulledRow[], replace: OfflineKind[]): Promise<void>;
  rows(kind: OfflineKind): Promise<StoredRow[]>;
  clearRows(): Promise<void>;
  enqueue(op: OutboxOp): Promise<void>;
  /** File d'envoi, dans l'ordre des numéros (deviceSeq). */
  outbox(): Promise<OutboxOp[]>;
  updateOps(patches: { opId: string; patch: Partial<OutboxOp> }[]): Promise<void>;
  removeOps(opIds: string[]): Promise<void>;
  getMeta(key: MetaKey): Promise<string | null>;
  setMeta(key: MetaKey, value: string | null): Promise<void>;
}

export interface PullQuery {
  cursor: string;
  scope?: string;
  page?: string;
  date: string;
}

/** Accès au serveur : POST /sync/push et GET /sync/pull. */
export interface Transport {
  push(operations: SyncOperationInput[]): Promise<SyncPushResponse>;
  pull(query: PullQuery): Promise<SyncPullResponse>;
}

/** Pas de réponse du serveur : réseau coupé, délai dépassé. */
export class NetworkError extends Error {}

/** Réponse d'erreur du serveur. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SyncReport {
  ok: boolean;
  pushed: number;
  conflicts: number;
  changes: number;
  pulled: number;
  error?: string;
}
