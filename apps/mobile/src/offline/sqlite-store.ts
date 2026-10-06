import type { MetaKey, OfflineStore, OutboxOp, StoredRow } from '@sellwasl/offline';
import type { OfflineKind, PulledRow } from '@sellwasl/validation';
import * as SQLite from 'expo-sqlite';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS records (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    op_id TEXT PRIMARY KEY NOT NULL,
    device_seq INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

/**
 * Base locale du téléphone (spec phase 23 §5) : données reçues (`records`), file d'envoi
 * (`outbox`) et curseurs (`meta`). Les accès passent l'un après l'autre : une transaction
 * d'expo-sqlite inclut toute requête lancée pendant qu'elle est ouverte.
 */
export class SqliteStore implements OfflineStore {
  private db: Promise<SQLite.SQLiteDatabase> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private open(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db)
      this.db = SQLite.openDatabaseAsync('sellwasl-offline.db').then(async (db) => {
        await db.execAsync(SCHEMA);
        return db;
      });
    return this.db;
  }

  /** Exécute un accès après les précédents. */
  private run<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => fn(await this.open()));
    this.chain = next.catch(() => undefined);
    return next;
  }

  applyPull(rows: PulledRow[], replace: OfflineKind[]): Promise<void> {
    return this.run((db) =>
      db.withExclusiveTransactionAsync(async (txn) => {
        for (const kind of replace) await txn.runAsync('DELETE FROM records WHERE kind = ?', kind);
        for (const r of rows) {
          if (r.deleted)
            await txn.runAsync('DELETE FROM records WHERE kind = ? AND id = ?', r.kind, r.id);
          else
            await txn.runAsync(
              'INSERT OR REPLACE INTO records (kind, id, data) VALUES (?, ?, ?)',
              r.kind,
              r.id,
              JSON.stringify(r.data),
            );
        }
      }),
    );
  }

  rows(kind: OfflineKind): Promise<StoredRow[]> {
    return this.run(async (db) =>
      (
        await db.getAllAsync<{ id: string; data: string }>(
          'SELECT id, data FROM records WHERE kind = ?',
          kind,
        )
      ).map((r) => ({ id: r.id, data: JSON.parse(r.data) as unknown })),
    );
  }

  /** Toutes les données reçues, par sorte (une seule lecture pour construire la vue). */
  allRows(): Promise<Partial<Record<OfflineKind, StoredRow[]>>> {
    return this.run(async (db) => {
      const out: Partial<Record<OfflineKind, StoredRow[]>> = {};
      const rows = await db.getAllAsync<{ kind: OfflineKind; id: string; data: string }>(
        'SELECT kind, id, data FROM records',
      );
      for (const r of rows)
        (out[r.kind] ??= []).push({ id: r.id, data: JSON.parse(r.data) as unknown });
      return out;
    });
  }

  clearRows(): Promise<void> {
    return this.run(async (db) => {
      await db.runAsync('DELETE FROM records');
    });
  }

  /** Tout effacer : changement d'utilisateur ou nouvelle association du téléphone. */
  wipe(): Promise<void> {
    return this.run(async (db) => {
      await db.execAsync('DELETE FROM records; DELETE FROM outbox; DELETE FROM meta;');
    });
  }

  enqueue(op: OutboxOp): Promise<void> {
    return this.run(async (db) => {
      await db.runAsync(
        'INSERT INTO outbox (op_id, device_seq, body) VALUES (?, ?, ?)',
        op.opId,
        op.deviceSeq,
        JSON.stringify(op),
      );
    });
  }

  outbox(): Promise<OutboxOp[]> {
    return this.run(async (db) =>
      (await db.getAllAsync<{ body: string }>('SELECT body FROM outbox ORDER BY device_seq')).map(
        (r) => JSON.parse(r.body) as OutboxOp,
      ),
    );
  }

  updateOps(patches: { opId: string; patch: Partial<OutboxOp> }[]): Promise<void> {
    if (patches.length === 0) return Promise.resolve();
    return this.run((db) =>
      db.withExclusiveTransactionAsync(async (txn) => {
        for (const { opId, patch } of patches) {
          const row = await txn.getFirstAsync<{ body: string }>(
            'SELECT body FROM outbox WHERE op_id = ?',
            opId,
          );
          if (!row) continue;
          const op = { ...(JSON.parse(row.body) as OutboxOp), ...patch };
          await txn.runAsync(
            'UPDATE outbox SET device_seq = ?, body = ? WHERE op_id = ?',
            op.deviceSeq,
            JSON.stringify(op),
            opId,
          );
        }
      }),
    );
  }

  removeOps(opIds: string[]): Promise<void> {
    if (opIds.length === 0) return Promise.resolve();
    return this.run(async (db) => {
      await db.runAsync(
        `DELETE FROM outbox WHERE op_id IN (${opIds.map(() => '?').join(', ')})`,
        ...opIds,
      );
    });
  }

  getMeta(key: MetaKey): Promise<string | null> {
    return this.run(
      async (db) =>
        (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))
          ?.value ?? null,
    );
  }

  setMeta(key: MetaKey, value: string | null): Promise<void> {
    return this.run(async (db) => {
      if (value === null) await db.runAsync('DELETE FROM meta WHERE key = ?', key);
      else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
    });
  }
}
