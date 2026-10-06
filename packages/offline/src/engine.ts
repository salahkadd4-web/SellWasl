import type {
  OfflineKind,
  OperationType,
  PulledRow,
  SyncOperationInput,
  SyncResult,
} from '@sellwasl/validation';
import {
  HttpError,
  type OfflineStore,
  type OutboxOp,
  type SyncReport,
  type Transport,
} from './types';

/** Délais entre deux essais après une erreur réseau ou serveur (spec phase 23 §4.2). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000] as const;
/** Opérations par envoi (docs/api.md §6.1). */
export const PUSH_BATCH = 100;

export interface EngineDeps {
  store: OfflineStore;
  transport: Transport;
  /** Identifiant d'une opération (UUID v7 sur le téléphone). */
  newId: () => string;
  /** Date du téléphone, AAAA-MM-JJ (première réception du jour complète). */
  today: () => string;
  now?: () => Date;
}

const UNSENT = new Set(['PENDING', 'SYNCING', 'FAILED']);
const applied = (r: SyncResult) => r.status === 'APPLIED' || r.status === 'APPLIED_WITH_CHANGES';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Erreur inattendue. Réessayez.';

/**
 * Moteur hors connexion (BR-SYN-01, BR-SYN-02) : chaque action est mise en file avec un opId et un
 * numéro d'ordre, puis envoyée dans l'ordre ; le téléphone relit ensuite ses données. Un seul
 * cycle à la fois : une demande pendant un cycle en relance un à la fin.
 */
export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private force = false;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Prévenu quand la file ou les données reçues changent. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Exclusion des écritures de numéros (mise en file, renumérotation). */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Met une action en file : elle partira au prochain cycle (BR-SYN-01). */
  enqueue(
    type: OperationType,
    payload: Record<string, unknown>,
    workdayId: string | null,
    opId: string = this.deps.newId(),
  ): Promise<OutboxOp> {
    return this.exclusive(async () => {
      const { store } = this.deps;
      const deviceSeq = Number((await store.getMeta('deviceSeq')) ?? '0') + 1;
      await store.setMeta('deviceSeq', String(deviceSeq));
      const op: OutboxOp = {
        opId,
        deviceSeq,
        type,
        payload,
        workdayId,
        occurredAt: this.now().toISOString(),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: null,
        error: null,
        result: null,
        changes: [],
        seen: true,
        reflected: false,
      };
      await store.enqueue(op);
      this.emit();
      return op;
    });
  }

  /** L'utilisateur a vu un refus ou des changements : une opération appliquée quitte la file. */
  async markSeen(opIds: string[]): Promise<void> {
    const ops = (await this.deps.store.outbox()).filter((o) => opIds.includes(o.opId));
    await this.deps.store.updateOps(ops.map((o) => ({ opId: o.opId, patch: { seen: true } })));
    await this.deps.store.removeOps(ops.filter((o) => o.status === 'SYNCED').map((o) => o.opId));
    this.emit();
  }

  /** Un cycle ; `force` (bouton « Synchroniser ») ignore les délais entre essais. */
  sync(options: { force?: boolean } = {}): Promise<SyncReport> {
    if (options.force) this.force = true;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let report: SyncReport;
      do {
        this.again = false;
        const force = this.force;
        this.force = false;
        report = await this.cycle(force);
      } while (this.again && report.ok);
      return report;
    })().finally(() => {
      this.running = null;
      this.emit();
    });
    return this.running;
  }

  private async cycle(force: boolean): Promise<SyncReport> {
    const report: SyncReport = { ok: true, pushed: 0, conflicts: 0, changes: 0, pulled: 0 };
    try {
      await this.pushAll(force, report);
      if (!report.ok) return report;
      report.pulled = await this.pullAll();
      await this.finish();
      await this.deps.store.setMeta('lastError', null);
      await this.deps.store.setMeta('lastSyncAt', this.now().toISOString());
    } catch (error) {
      report.ok = false;
      report.error = message(error);
      await this.deps.store.setMeta('lastError', report.error);
    }
    return report;
  }

  /** Envoi de la file, dans l'ordre, par lots ; s'arrête à la première erreur réseau. */
  private async pushAll(force: boolean, report: SyncReport): Promise<void> {
    const { store, transport } = this.deps;
    let renumbered = false;
    for (;;) {
      const unsent = (await store.outbox()).filter((o) => UNSENT.has(o.status));
      if (unsent.length === 0) return;
      // Le serveur exige l'ordre : une opération en attente de délai retient les suivantes
      const first = unsent[0]!;
      if (
        !force &&
        first.status === 'FAILED' &&
        first.nextAttemptAt &&
        first.nextAttemptAt > this.now().toISOString()
      )
        return;
      const batch = unsent.slice(0, PUSH_BATCH);
      await store.updateOps(batch.map((o) => ({ opId: o.opId, patch: { status: 'SYNCING' } })));
      this.emit();

      let results: SyncResult[];
      try {
        results = (await transport.push(batch.map(toInput))).results;
      } catch (error) {
        // Sans réponse lisible, le serveur a peut-être appliqué : le même opId repartira
        const at = this.now().getTime();
        await store.updateOps(
          batch.map((o) => {
            const attempts = o.attempts + 1;
            const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
            return {
              opId: o.opId,
              patch: {
                status: 'FAILED',
                attempts,
                nextAttemptAt: new Date(at + delay).toISOString(),
                error:
                  error instanceof HttpError
                    ? { code: error.code, message: error.message }
                    : { code: 'NETWORK', message: message(error) },
              },
            };
          }),
        );
        report.ok = false;
        report.error = message(error);
        await store.setMeta('lastError', report.error);
        return;
      }

      const byId = new Map(results.map((r) => [r.opId, r]));
      let expected: number | null = null;
      const patches: { opId: string; patch: Partial<OutboxOp> }[] = [];
      for (const o of batch) {
        const r = byId.get(o.opId);
        const seq = r?.result?.expectedDeviceSeq;
        if (
          !r ||
          r.status === 'GAP' ||
          (r.error?.code === 'DUPLICATE' && typeof seq === 'number')
        ) {
          if (typeof seq === 'number' && expected === null) expected = seq;
          patches.push({ opId: o.opId, patch: { status: 'PENDING' } });
        } else if (applied(r)) {
          const changes = r.changes ?? [];
          report.pushed += 1;
          report.changes += changes.length ? 1 : 0;
          patches.push({
            opId: o.opId,
            patch: {
              status: 'SYNCED',
              result: r.result ?? null,
              changes,
              error: null,
              seen: changes.length === 0,
              reflected: false,
            },
          });
        } else {
          report.conflicts += 1;
          patches.push({
            opId: o.opId,
            patch: {
              status: 'CONFLICT',
              error: r.error ?? { code: 'REJECTED', message: 'Action refusée par le serveur.' },
              seen: false,
            },
          });
        }
      }
      await store.updateOps(patches);
      this.emit();
      if (expected !== null) {
        if (renumbered) {
          report.ok = false;
          report.error = 'Numérotation des opérations décalée. Réessayez.';
          return;
        }
        await this.renumber(expected);
        renumbered = true;
      }
    }
  }

  /** Recale les numéros des opérations non envoyées sur celui qu'attend le serveur. */
  private renumber(expected: number): Promise<void> {
    return this.exclusive(async () => {
      const { store } = this.deps;
      const unsent = (await store.outbox()).filter((o) => UNSENT.has(o.status));
      await store.updateOps(
        unsent.map((o, i) => ({ opId: o.opId, patch: { deviceSeq: expected + i } })),
      );
      await store.setMeta('deviceSeq', String(expected + unsent.length - 1));
    });
  }

  /** Réception jusqu'à la dernière page, écrite en une fois ; repart de zéro si le périmètre change. */
  private async pullAll(): Promise<number> {
    const { store, transport } = this.deps;
    const today = this.deps.today();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const full = (await store.getMeta('lastFullSyncDate')) !== today;
      const cursor = full ? '0' : ((await store.getMeta('cursor')) ?? '0');
      const scope = full ? undefined : ((await store.getMeta('scope')) ?? undefined);
      const rows: PulledRow[] = [];
      const replace = new Set<OfflineKind>();
      let page: string | undefined;
      let reset = false;
      let last;
      do {
        last = await transport.pull({
          cursor,
          date: today,
          ...(scope !== undefined ? { scope } : {}),
          ...(page ? { page } : {}),
        });
        if (last.reset) {
          reset = true;
          break;
        }
        rows.push(...last.rows);
        last.replace.forEach((k) => replace.add(k));
        page = last.page ?? undefined;
      } while (last.hasMore);
      if (reset) {
        // Secteur ou camion changé : les données reçues ne valent plus (RESYNC_REQUIRED)
        await store.clearRows();
        await store.setMeta('cursor', null);
        await store.setMeta('scope', null);
        await store.setMeta('lastFullSyncDate', null);
        continue;
      }
      await store.applyPull(rows, [...replace]);
      await store.setMeta('cursor', last.cursor);
      await store.setMeta('scope', last.scope);
      if (cursor === '0') await store.setMeta('lastFullSyncDate', today);
      this.emit();
      return rows.length;
    }
    throw new Error('Périmètre de synchronisation instable. Réessayez.');
  }

  /** Après une réception complète : l'effet des opérations appliquées est dans les données. */
  private async finish(): Promise<void> {
    const { store } = this.deps;
    const synced = (await store.outbox()).filter((o) => o.status === 'SYNCED');
    await store.removeOps(synced.filter((o) => o.seen).map((o) => o.opId));
    await store.updateOps(
      synced.filter((o) => !o.seen).map((o) => ({ opId: o.opId, patch: { reflected: true } })),
    );
  }
}

function toInput(o: OutboxOp): SyncOperationInput {
  return {
    opId: o.opId,
    deviceSeq: o.deviceSeq,
    type: o.type,
    occurredAt: o.occurredAt,
    workdayId: o.workdayId,
    payload: o.payload,
  };
}
