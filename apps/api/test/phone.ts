import type {
  DeviceActivationResponse,
  FieldUserDevice,
  SyncPushResponse,
  SyncResult,
  TodayResponse,
} from '@sellwasl/validation';
import { expect } from 'vitest';
import { uuidv7 } from '../src/common/uuid';
import { call, PASSWORD, type TestApp } from './helpers';

/** Téléphone d'un vendeur : jeton, appareil, et numéro d'ordre de ses opérations. */
export interface Phone {
  token: string;
  deviceId: string;
  series: string;
  seq: number;
}

export interface Op {
  opId: string;
  deviceSeq: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/**
 * Téléphones des vendeurs pour un fichier de tests : un par vendeur (l'association est limitée en
 * débit), et les opérations numérotées comme sur un vrai téléphone.
 */
export class Phones {
  private readonly phones = new Map<string, Phone>();

  constructor(
    private readonly t: TestApp,
    /** Jeton d'un superviseur par code d'entreprise. */
    private readonly sups: Record<string, string>,
  ) {}

  async get(code: string, company = 'DISTRI-ORAN'): Promise<Phone> {
    const cached = this.phones.get(code);
    if (cached) return cached;
    const sup = this.sups[company]!;
    const list = await call<FieldUserDevice[]>(this.t.url, 'GET', '/devices', { token: sup });
    const user = list.body.find((u) => u.code === code)!;
    const activation = await call<{ code: string }>(
      this.t.url,
      'POST',
      `/users/${user.userId}/activation-codes`,
      { token: sup },
    );
    const reply = await call<DeviceActivationResponse>(
      this.t.url,
      'POST',
      '/auth/device/activate',
      { body: { code: activation.body.code, password: PASSWORD } },
    );
    const p = {
      token: reply.body.accessToken,
      deviceId: reply.body.device.id,
      series: reply.body.device.series,
      seq: 0,
    };
    this.phones.set(code, p);
    return p;
  }

  op(p: Phone, type: string, payload: Record<string, unknown>): Op {
    p.seq += 1;
    return {
      opId: uuidv7(),
      deviceSeq: p.seq,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  push(p: Phone, operations: Op[]) {
    return call<SyncPushResponse>(this.t.url, 'POST', '/sync/push', {
      token: p.token,
      body: { deviceId: p.deviceId, operations },
    });
  }

  async send(p: Phone, type: string, payload: Record<string, unknown>): Promise<SyncResult> {
    const reply = await this.push(p, [this.op(p, type, payload)]);
    expect(reply.status).toBe(200);
    return reply.body.results[0]!;
  }

  today(p: Phone, date: string) {
    return call<TodayResponse>(this.t.url, 'GET', `/me/today?date=${date}`, { token: p.token });
  }

  async startDay(p: Phone, date: string): Promise<string> {
    const workdayId = uuidv7();
    expect(await this.send(p, 'workday.start', { workdayId, date })).toMatchObject({
      status: 'APPLIED',
    });
    return workdayId;
  }

  async closeDay(p: Phone, workdayId: string): Promise<void> {
    expect(await this.send(p, 'workday.close', { workdayId })).toMatchObject({
      status: 'APPLIED',
    });
  }

  /** Commence une visite et renvoie son identifiant. */
  async startVisit(p: Phone, customerId: string, mode: 'ON_SITE' | 'PHONE' = 'PHONE') {
    const visitId = uuidv7();
    expect(await this.send(p, 'visit.start', { visitId, customerId, mode })).toMatchObject({
      status: 'APPLIED',
    });
    return visitId;
  }
}
