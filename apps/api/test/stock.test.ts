import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Entrepôt et stock (phase 17). */
describe('stock (phase 17)', () => {
  let t: TestApp;
  let raw: PrismaService;
  let sup: string;

  beforeAll(async () => {
    t = await startApp();
    raw = t.app.get(PrismaService);
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
  });
  afterAll(async () => {
    await t.close();
  });

  describe('données', () => {
    it("l'admin et le superviseur peuvent faire les opérations de stock sur le Web", async () => {
      const me = await call<{ permissions: string[] }>(t.url, 'GET', '/me', { token: sup });
      expect(me.body.permissions).toEqual(
        expect.arrayContaining([
          'stock.receive',
          'inventory.count',
          'loads.load',
          'unloads.validate',
        ]),
      );
    });

    it("les motifs d'écart de déchargement existent", async () => {
      const labels = await raw.reason.findMany({
        where: { company: { code: 'DISTRI-ORAN' }, kind: 'ADJUSTMENT' },
        select: { label: true },
      });
      expect(labels.map((r) => r.label)).toEqual(
        expect.arrayContaining(['Retour client', 'Marchandise manquante']),
      );
    });
  });
});
