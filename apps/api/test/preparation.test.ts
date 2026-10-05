import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Préparation des tournées (phase 18). */
describe('préparation (phase 18)', () => {
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

  it("l'admin et le superviseur peuvent préparer sur le Web", async () => {
    const me = await call<{ permissions: string[] }>(t.url, 'GET', '/me', { token: sup });
    expect(me.body.permissions).toEqual(
      expect.arrayContaining(['preparation.launch', 'preparation.do']),
    );
    expect(raw).toBeTruthy();
  });
});
