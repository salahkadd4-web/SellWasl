import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { startApp, type TestApp } from './helpers';

/** Réception différentielle du téléphone (phase 23). */
describe('synchronisation hors connexion (phase 23)', () => {
  let t: TestApp;
  let raw: PrismaService;

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
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
});
