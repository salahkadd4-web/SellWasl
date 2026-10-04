import type {
  CustomerHistory,
  DeviceActivationResponse,
  FieldUserDevice,
  SyncPushResponse,
  TodayResponse,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import type { SettingsResponse } from '../src/settings/settings.service';
import { call, PASSWORD, startApp, type TestApp, webLogin } from './helpers';

/** Téléphone d'un vendeur : jeton, appareil, et numéro d'ordre de ses opérations. */
interface Phone {
  token: string;
  deviceId: string;
  series: string;
  seq: number;
}

interface Op {
  opId: string;
  deviceSeq: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Samedi 3 octobre 2026 : partie 1 des secteurs (planning de la phase 14). */
const SATURDAY = '2026-10-03';

describe('journée du vendeur (phase 15)', () => {
  let t: TestApp;
  const sups: Record<string, string> = {};

  async function phone(code: string, company = 'DISTRI-ORAN'): Promise<Phone> {
    const sup = sups[company]!;
    const list = await call<FieldUserDevice[]>(t.url, 'GET', '/devices', { token: sup });
    const user = list.body.find((u) => u.code === code)!;
    const activation = await call<{ code: string }>(
      t.url,
      'POST',
      `/users/${user.userId}/activation-codes`,
      { token: sup },
    );
    const reply = await call<DeviceActivationResponse>(t.url, 'POST', '/auth/device/activate', {
      body: { code: activation.body.code, password: PASSWORD },
    });
    return {
      token: reply.body.accessToken,
      deviceId: reply.body.device.id,
      series: reply.body.device.series,
      seq: 0,
    };
  }

  /** Opération suivante du téléphone (deviceSeq incrémenté). */
  function op(p: Phone, type: string, payload: Record<string, unknown>): Op {
    p.seq += 1;
    return {
      opId: uuidv7(),
      deviceSeq: p.seq,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  const push = (p: Phone, operations: Op[]) =>
    call<SyncPushResponse>(t.url, 'POST', '/sync/push', {
      token: p.token,
      body: { deviceId: p.deviceId, operations },
    });

  /** Envoie une seule opération et renvoie son résultat. */
  async function send(p: Phone, type: string, payload: Record<string, unknown>) {
    const reply = await push(p, [op(p, type, payload)]);
    expect(reply.status).toBe(200);
    return reply.body.results[0]!;
  }

  const today = (p: Phone, date: string) =>
    call<TodayResponse>(t.url, 'GET', `/me/today?date=${date}`, { token: p.token });

  async function startDay(p: Phone, date: string): Promise<string> {
    const workdayId = uuidv7();
    const result = await send(p, 'workday.start', { workdayId, date });
    expect(result).toMatchObject({ status: 'APPLIED' });
    return workdayId;
  }

  async function closeDay(p: Phone, workdayId: string) {
    expect(await send(p, 'workday.close', { workdayId })).toMatchObject({ status: 'APPLIED' });
  }

  beforeAll(async () => {
    t = await startApp();
    sups['DISTRI-ORAN'] = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    sups['CASHVAN-EST'] = await webLogin(t.url, 'CASHVAN-EST', 'B-SUP');
  });
  afterAll(() => t.close());

  describe('réception des opérations (POST /sync/push)', () => {
    it('applique une opération une seule fois, même renvoyée (BR-SYN-02)', async () => {
      const p = await phone('V07');
      const workdayId = uuidv7();
      const start = op(p, 'workday.start', { workdayId, date: '2026-10-12' });
      const first = await push(p, [start]);
      expect(first.status).toBe(200);
      expect(first.body.results[0]).toMatchObject({ opId: start.opId, status: 'APPLIED' });
      const again = await push(p, [start]);
      expect(again.body.results[0]).toEqual(first.body.results[0]);
      await closeDay(p, workdayId);
    });

    it('signale un trou dans la numérotation de l’appareil (GAP)', async () => {
      const p = await phone('V08');
      p.seq = 4;
      const reply = await push(p, [
        op(p, 'workday.start', { workdayId: uuidv7(), date: '2026-10-12' }),
      ]);
      expect(reply.body.results[0]!.status).toBe('GAP');
    });

    it('refuse un type inconnu sans bloquer les opérations suivantes', async () => {
      const p = await phone('V08');
      const workdayId = uuidv7();
      const reply = await push(p, [
        op(p, 'unknown.type', {}),
        op(p, 'workday.start', { workdayId, date: '2026-10-13' }),
      ]);
      expect(reply.body.results.map((r) => r.status)).toEqual(['REJECTED', 'APPLIED']);
      expect(reply.body.results[0]!.error?.code).toBe('UNKNOWN_OPERATION');
      await closeDay(p, workdayId);
    });

    it('refuse un appareil qui n’est pas celui de la session', async () => {
      const p = await phone('V08');
      const reply = await call(t.url, 'POST', '/sync/push', {
        token: p.token,
        body: {
          deviceId: uuidv7(),
          operations: [op(p, 'workday.start', { workdayId: uuidv7(), date: '2026-10-14' })],
        },
      });
      expect(reply.status).toBe(403);
    });

    it('refuse le Web', async () => {
      const reply = await call(t.url, 'POST', '/sync/push', {
        token: sups['DISTRI-ORAN'],
        body: { deviceId: uuidv7(), operations: [] },
      });
      expect([400, 403]).toContain(reply.status);
    });
  });

  describe('journée de travail', () => {
    it('démarre la journée une fois par jour et la montre dans /me/today (BR-JOU-01)', async () => {
      const p = await phone('V07');
      const before = await today(p, SATURDAY);
      expect(before.status).toBe(200);
      expect(before.body.workday).toBeNull();
      expect(before.body.day.part?.name).toBe('Partie 1');
      expect(before.body.counters.planned).toBe(before.body.day.customers.length);

      await startDay(p, SATURDAY);
      const after = await today(p, SATURDAY);
      expect(after.body.workday).toMatchObject({ status: 'IN_PROGRESS' });
      expect(after.body.counters).toMatchObject({
        visited: 0,
        outOfProgram: 0,
        collectedAmount: 0,
      });
      expect(after.body.seller).toMatchObject({ code: 'V07', series: p.series });

      const again = await send(p, 'workday.start', { workdayId: uuidv7(), date: SATURDAY });
      expect(again).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });
    });

    it('refuse un jour non travaillé quand l’entreprise l’interdit (P-01, BR-JOU-03)', async () => {
      const admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
      const current = (await call<SettingsResponse>(t.url, 'GET', '/settings', { token: admin }))
        .body.data;
      const put = (allowed: boolean) =>
        call(t.url, 'PUT', '/settings', {
          token: admin,
          body: { ...current, rules: { ...current.rules, P01_workOnNonWorkingDays: allowed } },
        });
      expect((await put(false)).status).toBe(200);
      try {
        const p = await phone('V08');
        // Vendredi 9 octobre : chômé
        const refused = await send(p, 'workday.start', {
          workdayId: uuidv7(),
          date: '2026-10-09',
        });
        expect(refused).toMatchObject({ status: 'REJECTED', error: { code: 'BUSINESS_RULE' } });
      } finally {
        await put(true);
      }
      const p = await phone('V08');
      await closeDay(p, await startDay(p, '2026-10-09'));
    });

    it('clôture : refusée avec une visite en cours, puis crée les visites manquées (BR-JOU-06, BR-PLA-06)', async () => {
      const p = await phone('V08');
      const workdayId = await startDay(p, SATURDAY);
      const day = (await today(p, SATURDAY)).body.day;
      expect(day.customers.length).toBeGreaterThan(1);
      const [visited, missed] = day.customers;

      const visitId = uuidv7();
      expect(
        (await send(p, 'visit.start', { visitId, customerId: visited!.id, mode: 'PHONE' })).status,
      ).toBe('APPLIED');
      const blocked = await send(p, 'workday.close', { workdayId });
      expect(blocked).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });

      const reasons = await call<{ id: string; kind: string }[]>(
        t.url,
        'GET',
        '/reasons?kind=NO_ORDER',
        { token: p.token },
      );
      const reasonId = reasons.body.find((r) => r.kind === 'NO_ORDER')!.id;
      expect((await send(p, 'visit.close_no_order', { visitId, reasonId })).status).toBe('APPLIED');
      expect((await send(p, 'workday.close', { workdayId })).status).toBe('APPLIED');

      const after = await today(p, SATURDAY);
      expect(after.body.workday?.status).toBe('CLOSED');
      expect(after.body.counters.visited).toBe(1);
      const history = await call<CustomerHistory>(
        t.url,
        'GET',
        `/customers/${missed!.id}/history`,
        { token: p.token },
      );
      expect(history.body.visits).toContainEqual(
        expect.objectContaining({ date: SATURDAY, status: 'MISSED' }),
      );
      const late = await send(p, 'visit.start', {
        visitId: uuidv7(),
        customerId: missed!.id,
        mode: 'PHONE',
      });
      expect(late).toMatchObject({ status: 'REJECTED', error: { code: 'INVALID_STATE' } });
    });
  });
});
