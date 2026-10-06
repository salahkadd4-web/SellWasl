import type { OfflineKind, PulledRow } from '@sellwasl/validation';
import type { MetaKey, OfflineStore, OutboxOp, StoredRow } from './types';

/** Stockage en mémoire : tests, et référence du comportement attendu de SQLite. */
export class MemoryStore implements OfflineStore {
  readonly records = new Map<OfflineKind, Map<string, unknown>>();
  private ops: OutboxOp[] = [];
  private meta = new Map<MetaKey, string>();

  async applyPull(rows: PulledRow[], replace: OfflineKind[]): Promise<void> {
    for (const kind of replace) this.records.set(kind, new Map());
    for (const r of rows) {
      const table = this.records.get(r.kind) ?? new Map<string, unknown>();
      if (r.deleted) table.delete(r.id);
      else table.set(r.id, structuredClone(r.data));
      this.records.set(r.kind, table);
    }
  }

  async rows(kind: OfflineKind): Promise<StoredRow[]> {
    return [...(this.records.get(kind) ?? new Map<string, unknown>())].map(([id, data]) => ({
      id,
      data: structuredClone(data),
    }));
  }

  async clearRows(): Promise<void> {
    this.records.clear();
  }

  async enqueue(op: OutboxOp): Promise<void> {
    this.ops.push(structuredClone(op));
  }

  async outbox(): Promise<OutboxOp[]> {
    return structuredClone([...this.ops].sort((a, b) => a.deviceSeq - b.deviceSeq));
  }

  async updateOps(patches: { opId: string; patch: Partial<OutboxOp> }[]): Promise<void> {
    for (const { opId, patch } of patches) {
      const i = this.ops.findIndex((o) => o.opId === opId);
      if (i >= 0) this.ops[i] = { ...this.ops[i]!, ...structuredClone(patch) };
    }
  }

  async removeOps(opIds: string[]): Promise<void> {
    this.ops = this.ops.filter((o) => !opIds.includes(o.opId));
  }

  async getMeta(key: MetaKey): Promise<string | null> {
    return this.meta.get(key) ?? null;
  }

  async setMeta(key: MetaKey, value: string | null): Promise<void> {
    if (value === null) this.meta.delete(key);
    else this.meta.set(key, value);
  }
}
