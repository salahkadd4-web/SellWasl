import type { FieldUserDevice, UserDevicesResponse } from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { PrismaService } from '../src/prisma/prisma.service';
import { call, PASSWORD, startApp, type TestApp, webLogin } from './helpers';

/** Phase 10 : appareils, sessions et signal de vie (UC-59, BR-JOU-09). */
describe('appareils et connexions', () => {
  let t: TestApp;
  let sup: string;
  let seller: FieldUserDevice;

  /** Associe un téléphone à l'utilisateur et renvoie l'appareil et son jeton d'accès. */
  async function activate(userId: string) {
    const code = await call<{ code: string }>(t.url, 'POST', `/users/${userId}/activation-codes`, {
      token: sup,
    });
    const reply = await call<{
      accessToken: string;
      refreshToken: string;
      device: { id: string; series: string };
    }>(t.url, 'POST', '/auth/device/activate', {
      body: { code: code.body.code, password: PASSWORD, device: { model: 'Test' } },
    });
    expect(reply.status).toBe(200);
    return reply.body;
  }

  const devices = async () =>
    (await call<FieldUserDevice[]>(t.url, 'GET', '/devices', { token: sup })).body;

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    seller = (await devices()).find((u) => u.code === 'V08')!;
  });
  afterAll(() => t.close());

  it('reçoit le signal de vie : batterie, opérations en attente, version', async () => {
    const phone = await activate(seller.userId);
    const beat = await call<{ positionRecorded: boolean; intervalMin: number }>(
      t.url,
      'POST',
      '/devices/heartbeat',
      { token: phone.accessToken, body: { batteryLevel: 64, pendingOps: 3, appVersion: '0.2.0' } },
    );
    expect(beat.status).toBe(200);
    expect(beat.body).toEqual({ positionRecorded: false, intervalMin: 5 });

    const row = (await devices()).find((u) => u.userId === seller.userId)!;
    expect(row.device).toMatchObject({ batteryLevel: 64, pendingOps: 3, appVersion: '0.2.0' });
    expect(row.activeSessions).toBe(1);
  });

  it('ne garde la position que pendant une journée en cours (BR-JOU-09)', async () => {
    const phone = await activate(seller.userId);
    const position = {
      latitude: 35.7,
      longitude: -0.63,
      accuracyM: 12,
      recordedAt: new Date().toISOString(),
    };
    const outside = await call<{ positionRecorded: boolean }>(t.url, 'POST', '/devices/heartbeat', {
      token: phone.accessToken,
      body: { pendingOps: 0, position },
    });
    expect(outside.body.positionRecorded).toBe(false);

    const prisma = t.app.get(PrismaService);
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'DISTRI-ORAN' } });
    // Journée du jour : une autre suite a pu la créer (date fixe tombée aujourd'hui) ; on la
    // réutilise et on remet son état à la fin
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const existing = await prisma.workday.findFirst({
      where: { companyId: company.id, userId: seller.userId, date: today },
    });
    const workday = existing
      ? await prisma.workday.update({
          where: { id: existing.id },
          data: { status: 'IN_PROGRESS' },
        })
      : await prisma.workday.create({
          data: {
            id: uuidv7(),
            companyId: company.id,
            userId: seller.userId,
            date: today,
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            settingsVersion: 1,
          },
        });
    const inside = await call<{ positionRecorded: boolean }>(t.url, 'POST', '/devices/heartbeat', {
      token: phone.accessToken,
      body: { pendingOps: 0, position },
    });
    expect(inside.body.positionRecorded).toBe(true);
    const pings = await prisma.devicePing.count({ where: { deviceId: phone.device.id } });
    expect(pings).toBe(1);

    // La journée de test ne doit pas bloquer les changements de mode des autres tests
    await prisma.devicePing.deleteMany({ where: { workdayId: workday.id } });
    if (existing)
      await prisma.workday.update({
        where: { id: existing.id },
        data: { status: existing.status },
      });
    else await prisma.workday.delete({ where: { id: workday.id } });
  });

  it('bloque puis réactive un appareil ; le téléphone doit se reconnecter', async () => {
    const phone = await activate(seller.userId);
    expect(
      (await call(t.url, 'POST', `/devices/${phone.device.id}/block`, { token: sup })).status,
    ).toBe(204);

    const refused = await call(t.url, 'GET', '/me', { token: phone.accessToken });
    expect(refused.status).toBe(401); // session fermée par le blocage
    const login = await call(t.url, 'POST', '/auth/device/login', {
      body: { deviceId: phone.device.id, password: PASSWORD },
    });
    expect(login.body.error?.code).toBe('DEVICE_BLOCKED');

    expect(
      (await call(t.url, 'POST', `/devices/${phone.device.id}/unblock`, { token: sup })).status,
    ).toBe(204);
    const again = await call(t.url, 'POST', '/auth/device/login', {
      body: { deviceId: phone.device.id, password: PASSWORD },
    });
    expect(again.status).toBe(200);
  });

  it('remplace un appareil bloqué par un nouveau, avec une nouvelle série', async () => {
    const old = await activate(seller.userId);
    await call(t.url, 'POST', `/devices/${old.device.id}/block`, { token: sup });
    const fresh = await activate(seller.userId);
    expect(fresh.device.series).not.toBe(old.device.series);

    const history = await call<UserDevicesResponse>(
      t.url,
      'GET',
      `/users/${seller.userId}/devices`,
      { token: sup },
    );
    const statuses = history.body.devices.map((d) => [d.id, d.status]);
    expect(statuses).toContainEqual([old.device.id, 'REVOKED']);
    expect(statuses).toContainEqual([fresh.device.id, 'ACTIVE']);
    expect(history.body.devices.filter((d) => d.status !== 'REVOKED')).toHaveLength(1);
    expect(
      (await call(t.url, 'POST', `/devices/${old.device.id}/unblock`, { token: sup })).status,
    ).toBe(422);
  });

  it('force une nouvelle authentification : sessions fermées, appareil conservé', async () => {
    const phone = await activate(seller.userId);
    const history = await call<UserDevicesResponse>(
      t.url,
      'GET',
      `/users/${seller.userId}/devices`,
      { token: sup },
    );
    expect(history.body.sessions).toHaveLength(1);

    expect(
      (
        await call(t.url, 'POST', `/sessions/${history.body.sessions[0]!.id}/revoke`, {
          token: sup,
        })
      ).status,
    ).toBe(204);
    expect((await call(t.url, 'GET', '/me', { token: phone.accessToken })).status).toBe(401);
    const refresh = await call(t.url, 'POST', '/auth/refresh', {
      body: { refreshToken: phone.refreshToken },
    });
    expect(refresh.status).toBe(401);

    const login = await call<{ accessToken: string }>(t.url, 'POST', '/auth/device/login', {
      body: { deviceId: phone.device.id, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(
      (await call(t.url, 'POST', `/users/${seller.userId}/sessions/revoke`, { token: sup })).status,
    ).toBe(204);
    expect((await call(t.url, 'GET', '/me', { token: login.body.accessToken })).status).toBe(401);
  });

  it('réserve appareils et signal de vie aux utilisateurs terrain', async () => {
    const beat = await call(t.url, 'POST', '/devices/heartbeat', {
      token: sup,
      body: { pendingOps: 0 },
    });
    expect(beat.status).toBe(422);

    const users = await call<{ id: string; code: string }[]>(t.url, 'GET', '/users', {
      token: sup,
    });
    const webAdmin = users.body.find((u) => u.code === 'A-ADM')!;
    const reply = await call(t.url, 'GET', `/users/${webAdmin.id}/devices`, { token: sup });
    expect(reply.status).toBe(422);
    expect((await devices()).some((u) => u.code === 'A-ADM')).toBe(false);
  });

  it('un vendeur ne peut pas bloquer un appareil', async () => {
    const phone = await activate(seller.userId);
    const reply = await call(t.url, 'POST', `/devices/${phone.device.id}/block`, {
      token: phone.accessToken,
    });
    expect(reply.status).toBe(403);
  });
});
