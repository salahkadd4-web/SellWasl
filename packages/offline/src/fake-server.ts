import type {
  PulledRow,
  SyncOperationInput,
  SyncPullResponse,
  SyncPushResponse,
  SyncResult,
} from '@sellwasl/validation';
import { NetworkError, type PullQuery, type Transport } from './types';

/**
 * Faux serveur pour les tests : idempotence par opId, numéros d'ordre attendus (GAP, DUPLICATE),
 * refus par type, réponse perdue, coupure réseau, réception par pages et changement de périmètre.
 */
export class FakeServer implements Transport {
  readonly applied = new Map<string, SyncResult>();
  /** Nombre d'applications réelles par opId (jamais plus d'une). */
  readonly applications = new Map<string, number>();
  readonly pushes: SyncOperationInput[][] = [];
  readonly pulls: PullQuery[] = [];
  expected = 1;
  offline = false;
  /** Applique puis perd la réponse (réseau coupé au retour). */
  loseNextResponse = false;
  rejectTypes = new Set<string>();
  /** Changements renvoyés pour un type (APPLIED_WITH_CHANGES). */
  changesFor = new Map<string, SyncResult['changes']>();
  rows: PulledRow[] = [];
  pageSize = 1000;
  scope = 'S1';
  cursor = '100';
  /** Appelé pendant un envoi (pour simuler une action de l'utilisateur au même moment). */
  onPush: (() => Promise<void>) | null = null;
  /** Appelé pendant une réception. */
  onPull: (() => Promise<void>) | null = null;

  async push(operations: SyncOperationInput[]): Promise<SyncPushResponse> {
    this.pushes.push(operations);
    if (this.onPush) {
      const hook = this.onPush;
      this.onPush = null;
      await hook();
    }
    if (this.offline) throw new NetworkError('Serveur injoignable.');
    const results: SyncResult[] = [];
    let gap = false;
    for (const op of operations) {
      const known = this.applied.get(op.opId);
      if (known) {
        results.push(known);
        continue;
      }
      if (gap || op.deviceSeq > this.expected) {
        gap = true;
        results.push({
          opId: op.opId,
          status: 'GAP',
          result: { expectedDeviceSeq: this.expected },
        });
        continue;
      }
      if (op.deviceSeq < this.expected) {
        results.push({
          opId: op.opId,
          status: 'REJECTED',
          result: { expectedDeviceSeq: this.expected },
          error: { code: 'DUPLICATE', message: 'Numéro déjà utilisé.' },
        });
        continue;
      }
      const changes = this.changesFor.get(op.type);
      const result: SyncResult = this.rejectTypes.has(op.type)
        ? {
            opId: op.opId,
            status: 'REJECTED',
            error: { code: 'BUSINESS_RULE', message: 'Refusée.' },
          }
        : changes
          ? { opId: op.opId, status: 'APPLIED_WITH_CHANGES', result: {}, changes }
          : { opId: op.opId, status: 'APPLIED', result: { ok: true } };
      this.applied.set(op.opId, result);
      this.applications.set(op.opId, (this.applications.get(op.opId) ?? 0) + 1);
      this.expected += 1;
      results.push(result);
    }
    if (this.loseNextResponse) {
      this.loseNextResponse = false;
      throw new NetworkError('Réponse perdue.');
    }
    return { results, serverTime: new Date().toISOString() };
  }

  async pull(query: PullQuery): Promise<SyncPullResponse> {
    this.pulls.push(query);
    if (this.onPull) {
      const hook = this.onPull;
      this.onPull = null;
      await hook();
    }
    if (this.offline) throw new NetworkError('Serveur injoignable.');
    const base = { scope: this.scope, serverTime: new Date().toISOString() };
    if (query.scope !== undefined && query.scope !== this.scope)
      return {
        ...base,
        rows: [],
        replace: [],
        cursor: '0',
        hasMore: false,
        page: null,
        reset: true,
      };
    const start = Number(query.page ?? 0);
    const rows = this.rows.slice(start, start + this.pageSize);
    const hasMore = start + this.pageSize < this.rows.length;
    return {
      ...base,
      rows,
      replace: start === 0 && query.cursor === '0' ? ['customer'] : [],
      cursor: hasMore ? query.cursor : this.cursor,
      hasMore,
      page: hasMore ? String(start + this.pageSize) : null,
      reset: false,
    };
  }
}
