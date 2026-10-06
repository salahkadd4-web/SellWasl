import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from './engine';
import { FakeServer } from './fake-server';
import { MemoryStore } from './memory-store';
import { syncStatus } from './status';

let ids = 0;
const newId = () => `op-${String(++ids).padStart(4, '0')}`;

describe('moteur de synchronisation (spec phase 23 §4.3)', () => {
  let store: MemoryStore;
  let server: FakeServer;
  let now: Date;
  let today: string;
  let engine: SyncEngine;

  beforeEach(() => {
    store = new MemoryStore();
    server = new FakeServer();
    now = new Date('2027-06-05T08:00:00Z');
    today = '2027-06-05';
    engine = new SyncEngine({
      store,
      transport: server,
      now: () => now,
      today: () => today,
      newId,
    });
  });

  const later = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  it('envoie une opération en file, puis la retire après la réception', async () => {
    const op = await engine.enqueue('visit.start', { visitId: 'v1' }, 'w1');
    expect(op).toMatchObject({ deviceSeq: 1, status: 'PENDING' });
    const report = await engine.sync();
    expect(report).toMatchObject({ ok: true, pushed: 1 });
    expect(server.applications.get(op.opId)).toBe(1);
    expect(await store.outbox()).toEqual([]);
    expect(await store.getMeta('cursor')).toBe('100');
  });

  it('réponse perdue : nouvel essai après le délai, appliquée une seule fois', async () => {
    const op = await engine.enqueue('order.confirm', { orderId: 'o1' }, 'w1');
    server.loseNextResponse = true;
    const first = await engine.sync();
    expect(first.ok).toBe(false);
    expect((await store.outbox())[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    // Avant le délai : rien n'est renvoyé
    await engine.sync();
    expect(server.pushes).toHaveLength(1);
    later(5_000);
    expect((await engine.sync()).ok).toBe(true);
    expect(server.pushes).toHaveLength(2);
    expect(server.pushes[1]![0]!.opId).toBe(op.opId);
    expect(server.applications.get(op.opId)).toBe(1);
    expect(await store.outbox()).toEqual([]);
  });

  it('trou dans la numérotation : renumérote et envoie dans le même cycle', async () => {
    await store.setMeta('deviceSeq', '5');
    server.expected = 4;
    const a = await engine.enqueue('visit.start', { visitId: 'v1' }, 'w1');
    const b = await engine.enqueue('visit.close_no_order', { visitId: 'v1' }, 'w1');
    expect([a.deviceSeq, b.deviceSeq]).toEqual([6, 7]);
    const report = await engine.sync();
    expect(report.ok).toBe(true);
    expect(server.applications.get(a.opId)).toBe(1);
    expect(server.applications.get(b.opId)).toBe(1);
    expect(server.pushes.at(-1)!.map((o) => o.deviceSeq)).toEqual([4, 5]);
    expect(await store.getMeta('deviceSeq')).toBe('5');
  });

  it('refus du serveur : CONFLICT gardé avec son motif, les suivantes continuent', async () => {
    server.rejectTypes.add('payment.debt');
    const refused = await engine.enqueue('payment.debt', { amount: 100 }, 'w1');
    const next = await engine.enqueue('visit.start', { visitId: 'v2' }, 'w1');
    const report = await engine.sync();
    expect(report).toMatchObject({ ok: true, conflicts: 1 });
    const outbox = await store.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      opId: refused.opId,
      status: 'CONFLICT',
      seen: false,
      error: { code: 'BUSINESS_RULE', message: 'Refusée.' },
    });
    expect(server.applications.get(next.opId)).toBe(1);
  });

  it('délais croissants entre les essais : 5 s, 15 s, 60 s, puis 5 min', async () => {
    await engine.enqueue('visit.start', { visitId: 'v1' }, 'w1');
    server.offline = true;
    const delays: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      await engine.sync({ force: true });
      const op = (await store.outbox())[0]!;
      delays.push(new Date(op.nextAttemptAt!).getTime() - now.getTime());
    }
    expect(delays).toEqual([5_000, 15_000, 60_000, 300_000, 300_000]);
  });

  it('une action pendant un cycle part au cycle suivant, jamais deux fois', async () => {
    const first = await engine.enqueue('visit.start', { visitId: 'v1' }, 'w1');
    let during: string | null = null;
    // Pendant la réception : l'envoi de ce cycle est déjà fait
    server.onPull = async () => {
      during = (await engine.enqueue('visit.close_no_order', { visitId: 'v1' }, 'w1')).opId;
      void engine.sync();
    };
    // Un seul appel : le cycle demandé pendant l'envoi est relancé à la fin du premier
    await engine.sync();
    expect(during).not.toBeNull();
    expect(server.applications.get(first.opId)).toBe(1);
    expect(server.applications.get(during!)).toBe(1);
    const sent = server.pushes.flat().map((o) => o.opId);
    expect(sent.filter((id) => id === during)).toHaveLength(1);
    expect(await store.outbox()).toEqual([]);
  });

  it('réception par pages : écrite une seule fois, avec les sortes remplacées', async () => {
    server.pageSize = 2;
    server.rows = [1, 2, 3, 4, 5].map((n) => ({
      kind: 'customer' as const,
      id: `c${n}`,
      data: { id: `c${n}` },
      deleted: false,
    }));
    const report = await engine.sync();
    expect(report).toMatchObject({ ok: true, pulled: 5 });
    expect(server.pulls.map((p) => p.page ?? null)).toEqual([null, '2', '4']);
    expect((await store.rows('customer')).map((r) => r.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(await store.getMeta('lastFullSyncDate')).toBe(today);
  });

  it('changement de périmètre : envoie d’abord, efface, puis relit tout', async () => {
    await engine.sync();
    await store.applyPull([{ kind: 'quota', id: 'q1', data: {}, deleted: false }], []);
    const op = await engine.enqueue('visit.start', { visitId: 'v1' }, 'w1');
    server.scope = 'S2';
    const report = await engine.sync();
    expect(report.ok).toBe(true);
    expect(server.applications.get(op.opId)).toBe(1);
    // Deuxième lecture : depuis zéro, sans périmètre
    expect(server.pulls.at(-2)).toMatchObject({ scope: 'S1' });
    expect(server.pulls.at(-1)).toMatchObject({ cursor: '0' });
    expect(server.pulls.at(-1)!.scope).toBeUndefined();
    expect(await store.rows('quota')).toEqual([]);
    expect(await store.getMeta('scope')).toBe('S2');
  });

  it('nouveau jour : la première réception est complète', async () => {
    await engine.sync();
    expect(server.pulls.at(-1)!.cursor).toBe('0');
    await engine.sync();
    expect(server.pulls.at(-1)!.cursor).toBe('100');
    today = '2027-06-06';
    await engine.sync();
    expect(server.pulls.at(-1)!.cursor).toBe('0');
    expect(server.pulls.at(-1)!.date).toBe('2027-06-06');
    expect(await store.getMeta('lastFullSyncDate')).toBe('2027-06-06');
  });

  it('changements reçus : gardés jusqu’à ce que l’utilisateur les voie', async () => {
    server.changesFor.set('order.confirm', [
      { kind: 'QUOTA_PENDING', productVariantId: 'v', pendingQty: 3 },
    ]);
    const op = await engine.enqueue('order.confirm', { orderId: 'o1' }, 'w1');
    await engine.sync();
    const kept = await store.outbox();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ status: 'SYNCED', seen: false, reflected: true });
    expect(kept[0]!.changes).toHaveLength(1);
    await engine.markSeen([op.opId]);
    expect(await store.outbox()).toEqual([]);
  });
});

describe('indicateur de synchronisation (BR-SYN-06)', () => {
  const op = (status: string, extra: object = {}) =>
    ({ status, seen: true, changes: [], ...extra }) as never;

  it('synchronisé, en attente, erreur', () => {
    expect(syncStatus([], null, true)).toEqual({
      state: 'SYNCED',
      pending: 0,
      conflicts: 0,
      unseenChanges: 0,
    });
    expect(syncStatus([op('PENDING'), op('FAILED'), op('SYNCING')], null, true)).toMatchObject({
      state: 'PENDING',
      pending: 3,
    });
    expect(syncStatus([op('CONFLICT', { seen: false })], null, true)).toMatchObject({
      state: 'ERROR',
      conflicts: 1,
    });
    expect(syncStatus([], 'Serveur injoignable.', true).state).toBe('ERROR');
    // Hors ligne : une erreur de réseau n'est pas une erreur, les opérations attendent
    expect(syncStatus([op('PENDING')], 'Serveur injoignable.', false).state).toBe('PENDING');
    expect(
      syncStatus([op('SYNCED', { seen: false, changes: [{ kind: 'STOCKOUT' }] })], null, true),
    ).toMatchObject({ state: 'SYNCED', unseenChanges: 1 });
  });
});
