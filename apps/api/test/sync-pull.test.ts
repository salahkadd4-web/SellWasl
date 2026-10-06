import type {
  CustomerDto,
  OfflineKind,
  PlanningDay,
  PulledRow,
  SyncPullResponse,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';
import { type Phone, Phones } from './phone';

/** Samedi réservé à cette suite. */
const DAY = '2027-06-05';

/** Réception différentielle du téléphone (phase 23). */
describe('synchronisation hors connexion (phase 23)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let supA: string;
  let supB: string;
  let phones: Phones;
  let seller: Phone;

  const pull = (p: Phone, query: Record<string, string>) =>
    call<SyncPullResponse>(
      t.url,
      'GET',
      `/sync/pull?${new URLSearchParams({ date: DAY, ...query }).toString()}`,
      { token: p.token },
    );

  /** Réception complète, page par page, comme le téléphone. */
  async function pullAll(p: Phone, cursor = '0', scope?: string) {
    const rows: PulledRow[] = [];
    const replace = new Set<OfflineKind>();
    let page: string | null = null;
    let last: SyncPullResponse;
    do {
      const reply = await pull(p, {
        cursor,
        ...(scope ? { scope } : {}),
        ...(page ? { page } : {}),
      });
      expect(reply.status, JSON.stringify(reply.body)).toBe(200);
      last = reply.body;
      rows.push(...last.rows);
      last.replace.forEach((k) => replace.add(k));
      page = last.page;
    } while (last.hasMore);
    return { rows, replace, cursor: last.cursor, scope: last.scope, last };
  }

  const kindsOf = (rows: PulledRow[]) => new Set(rows.map((r) => r.kind));

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    supA = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    supB = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
    phones = new Phones(t, { 'DISTRI-ORAN': supA, 'CASHVAN-EST': supB });
    seller = await phones.get('V07');
  });
  afterAll(() => t.close());

  describe('curseur fiable (change_xid)', () => {
    it('enregistre la transaction de chaque écriture', async () => {
      const [row] = await raw.$queryRaw<{ xid: bigint }[]>`
        UPDATE reason SET label = label WHERE id = (SELECT id FROM reason LIMIT 1)
        RETURNING change_xid AS xid`;
      const [snap] = await raw.$queryRaw<{ xmin: bigint }[]>`
        SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint AS xmin`;
      expect(row!.xid).toBeGreaterThan(0n);
      expect(snap!.xmin).toBeGreaterThan(row!.xid);
    });
  });

  describe('réception (GET /sync/pull)', () => {
    it('pré-vendeur : réception complète de son périmètre', async () => {
      const all = await pullAll(seller);
      const kinds = kindsOf(all.rows);
      for (const k of [
        'settings',
        'reason',
        'product',
        'pricing',
        'territory',
        'planningDay',
        'customer',
      ] as const)
        expect(kinds.has(k), k).toBe(true);
      expect(kinds.has('driverDay')).toBe(false);
      expect(kinds.has('truckStock')).toBe(false);
      // Réception complète : toutes les sortes reçues sont remplacées
      for (const k of kinds) expect(all.replace.has(k), k).toBe(true);
      // Clients de son secteur seulement
      const user = await raw.user.findFirstOrThrow({
        where: { code: 'V07', company: { code: 'DISTRI-ORAN' } },
      });
      const sectors = (await raw.territory.findMany({ where: { sellerUserId: user.id } })).map(
        (s) => s.id,
      );
      const customers = all.rows.filter((r) => r.kind === 'customer');
      expect(customers.length).toBeGreaterThan(0);
      for (const c of customers) expect(sectors).toContain((c.data as CustomerDto).territory?.id);
      // Planning du jour et du lendemain
      expect(
        all.rows.filter((r) => r.kind === 'planningDay').map((r) => (r.data as PlanningDay).date),
      ).toEqual([DAY, '2027-06-06']);
      expect(all.scope).toMatch(/^PRE_VENDEUR:t=/);
    });

    it('sans changement, la lecture suivante est vide', async () => {
      const first = await pullAll(seller);
      const next = await pullAll(seller, first.cursor, first.scope);
      // Paramètres : une ligne calculée, renvoyée à chaque fois
      expect(next.rows.filter((r) => r.kind !== 'settings')).toEqual([]);
      expect([...next.replace]).toEqual(['settings']);
    });

    it('renvoie seulement le client modifié, puis le supprime quand il sort du secteur', async () => {
      const first = await pullAll(seller);
      const customer = first.rows.find((r) => r.kind === 'customer')!;
      const patched = await call(t.url, 'PATCH', `/customers/${customer.id}`, {
        token: supA,
        body: { phone: '0550 11 22 33' },
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const next = await pullAll(seller, first.cursor, first.scope);
      const changed = next.rows.filter((r) => r.kind === 'customer');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({
        id: customer.id,
        deleted: false,
        data: { phone: '0550 11 22 33' },
      });
      expect(next.replace.has('customer')).toBe(false);

      // Hors du secteur : il part supprimé
      const before = await raw.customer.findUniqueOrThrow({ where: { id: customer.id } });
      const other = await raw.territory.findFirstOrThrow({
        where: {
          companyId: before.companyId,
          id: { not: before.territoryId! },
          sellerUserId: { not: null },
        },
      });
      await raw.customer.update({ where: { id: customer.id }, data: { territoryId: other.id } });
      try {
        const gone = await pullAll(seller, next.cursor, next.scope);
        expect(gone.rows.filter((r) => r.kind === 'customer')).toEqual([
          { kind: 'customer', id: customer.id, data: null, deleted: true },
        ]);
      } finally {
        await raw.customer.update({
          where: { id: customer.id },
          data: { territoryId: before.territoryId },
        });
      }
    });

    it('un prix modifié fait renvoyer toute la grille', async () => {
      const first = await pullAll(seller);
      const price = await raw.price.findFirstOrThrow({
        where: { company: { code: 'DISTRI-ORAN' }, deletedAt: null },
      });
      await raw.price.update({ where: { id: price.id }, data: { price: price.price } });
      const next = await pullAll(seller, first.cursor, first.scope);
      expect(next.replace.has('pricing')).toBe(true);
      expect(next.rows.filter((r) => r.kind === 'pricing').length).toBe(
        first.rows.filter((r) => r.kind === 'pricing').length,
      );
    });

    it('une écriture validée après la lecture arrive à la lecture suivante (transaction lente)', async () => {
      const first = await pullAll(seller);
      const customer = first.rows.find((r) => r.kind === 'customer')!;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let written!: () => void;
      const wrote = new Promise<void>((resolve) => (written = resolve));
      const slow = raw.$transaction(
        async (tx) => {
          await tx.customer.update({ where: { id: customer.id }, data: { address: 'Rue lente' } });
          written();
          await gate;
        },
        { timeout: 20_000 },
      );
      await wrote;
      // Une écriture plus récente est validée avant la lecture : un curseur « plus grande
      // transaction vue » sauterait la transaction lente
      await raw.$executeRaw`UPDATE reason SET label = label WHERE id = (SELECT id FROM reason LIMIT 1)`;
      // Lecture pendant que la transaction est ouverte : le client n'est pas encore visible
      const during = await pullAll(seller, first.cursor, first.scope);
      expect(during.rows.some((r) => r.kind === 'customer' && r.id === customer.id)).toBe(false);
      release();
      await slow;
      const after = await pullAll(seller, during.cursor, during.scope);
      expect(after.rows.find((r) => r.kind === 'customer' && r.id === customer.id)).toMatchObject({
        data: { address: 'Rue lente' },
      });
    });

    it('découpe la réception en pages, chaque ligne une seule fois', async () => {
      const whole = await pullAll(seller);
      process.env.SYNC_PULL_PAGE_SIZE = '5';
      try {
        const first = await pull(seller, { cursor: '0' });
        expect(first.body.hasMore).toBe(true);
        expect(first.body.rows).toHaveLength(5);
        expect(first.body.cursor).toBe('0');
        const paged = await pullAll(seller);
        const key = (r: PulledRow) => `${r.kind}:${r.id}`;
        expect(paged.rows.map(key).sort()).toEqual(whole.rows.map(key).sort());
        expect(new Set(paged.rows.map(key)).size).toBe(paged.rows.length);
        expect(BigInt(paged.cursor)).toBeGreaterThan(0n);
      } finally {
        delete process.env.SYNC_PULL_PAGE_SIZE;
      }
    });

    it('un périmètre différent demande de tout relire (reset)', async () => {
      const reply = await pull(seller, { cursor: '42', scope: 'PRE_VENDEUR:t=autre:w=' });
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ reset: true, rows: [], cursor: '0' });
    });

    it('cash van : stock du camion et pointage ; livreur : sa tournée', async () => {
      const cashvan = await pullAll(await phones.get('C01', 'CASHVAN-EST'));
      expect(kindsOf(cashvan.rows).has('truckStock')).toBe(true);
      expect(kindsOf(cashvan.rows).has('truckCheck')).toBe(true);
      expect(kindsOf(cashvan.rows).has('depotStock')).toBe(false);
      const driver = await pullAll(await phones.get('L01'));
      const kinds = kindsOf(driver.rows);
      expect(kinds.has('driverDay')).toBe(true);
      expect(kinds.has('quota')).toBe(false);
      expect(kinds.has('planningDay')).toBe(false);
      expect(driver.scope).toMatch(/^LIVREUR:/);
    });

    it('refuse le Web et le magasinier', async () => {
      const web = await call(t.url, 'GET', `/sync/pull?date=${DAY}`, { token: supA });
      expect(web.status).toBe(403);
      const storekeeper = await pull(await phones.get('M01'), {});
      expect(storekeeper.status).toBe(403);
      expect(storekeeper.body.error?.code).toBe('OFFLINE_NOT_AVAILABLE');
    });
  });
});
