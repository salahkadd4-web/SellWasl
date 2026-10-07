import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ACTIVATION_CODE_ALPHABET,
  activationQrPayload,
  type ActivationCodeResponse,
  companySettingsSchema,
  type DeviceSummary,
  type FieldUserDevice,
  type HeartbeatResponse,
  type heartbeatSchema,
  type SessionSummary,
  type UserDevicesResponse,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { hashActivationCode } from '../auth/auth.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

/** Validité d'un code d'association (ARC-04). */
const ACTIVATION_CODE_TTL_MS = 10 * 60 * 1000;
/** Deux signaux de vie rapprochés ne créent qu'un point de position (api.md §8). */
const MIN_PING_INTERVAL_MS = 25 * 1000;
/** Appareils en service : un seul par utilisateur, actif ou bloqué. */
const IN_SERVICE = { status: { in: ['ACTIVE', 'BLOCKED'] } } satisfies Prisma.DeviceWhereInput;

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);

type DeviceRow = Prisma.DeviceGetPayload<object>;

function toDeviceSummary(d: DeviceRow): DeviceSummary {
  return {
    id: d.id,
    series: d.series,
    status: d.status,
    model: d.model,
    osVersion: d.osVersion,
    appVersion: d.appVersion,
    activatedAt: d.activatedAt.toISOString(),
    revokedAt: d.revokedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
    batteryLevel: d.batteryLevel,
    pendingOps: d.pendingOps,
  };
}

/** Sessions encore valables. */
const openSessions = () =>
  ({ revokedAt: null, expiresAt: { gt: new Date() } }) satisfies Prisma.SessionWhereInput;

/** Appareils des utilisateurs terrain (UC-59, docs/api.md §3.2 et §3.3). */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Utilisateurs terrain de l'entreprise et leur appareil en service (UC-59). */
  async listFieldUsers(): Promise<FieldUserDevice[]> {
    const users = await this.db.user.findMany({
      where: { deletedAt: null, role: { channel: 'MOBILE' } },
      include: {
        role: true,
        devices: { where: IN_SERVICE, orderBy: { activatedAt: 'desc' } },
        _count: { select: { sessions: { where: openSessions() } } },
      },
      orderBy: { code: 'asc' },
    });
    return users.map((u) => ({
      userId: u.id,
      code: u.code,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role.name,
      userStatus: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      activeSessions: u._count.sessions,
      device: u.devices[0] ? toDeviceSummary(u.devices[0]) : null,
    }));
  }

  /** Historique des appareils d'un utilisateur terrain et ses sessions ouvertes. */
  async userDevices(userId: string): Promise<UserDevicesResponse> {
    await this.fieldUser(userId);
    const [devices, sessions] = await Promise.all([
      this.db.device.findMany({ where: { userId }, orderBy: { activatedAt: 'desc' } }),
      this.db.session.findMany({
        where: { userId, ...openSessions() },
        include: { device: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      devices: devices.map(toDeviceSummary),
      sessions: sessions.map((s): SessionSummary => ({
        id: s.id,
        channel: s.channel,
        deviceSeries: s.device?.series ?? null,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
        expiresAt: s.expiresAt.toISOString(),
        ip: s.ip,
      })),
    };
  }

  private async fieldUser(userId: string) {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { role: true, devices: { where: IN_SERVICE } },
    });
    if (!user) throw notFound('Utilisateur introuvable.');
    if (user.role.channel !== 'MOBILE') {
      throw rule('Seuls les utilisateurs terrain utilisent un appareil.', { rule: 'BR-USR-02' });
    }
    return user;
  }

  /** Code d'association à usage unique, valable 10 minutes (ARC-04, BR-USR-07, BR-USR-08). */
  async createActivationCode(actor: AuthUser, userId: string): Promise<ActivationCodeResponse> {
    const user = await this.fieldUser(userId);
    if (user.status !== 'ACTIVE') throw rule('Ce compte est désactivé.');

    const code = Array.from(
      { length: 8 },
      () => ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)],
    ).join('');
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_MS);
    await this.db.$transaction(async (tx) => {
      // Un seul code valable à la fois par utilisateur
      await tx.deviceActivationCode.updateMany({
        where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      await tx.deviceActivationCode.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId, // vérifié par le client filtré
          userId,
          codeHash: hashActivationCode(code),
          expiresAt,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'device.activation_code.create',
          entity: 'User',
          entityId: userId,
        },
        tx,
      );
    });

    return {
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      qrPayload: activationQrPayload(code),
      expiresAt: expiresAt.toISOString(),
      previousDevicePendingOps: user.devices[0]?.pendingOps ?? 0,
    };
  }

  /** Révocation définitive d'un appareil et de ses sessions (UC-59, BR-USR-11). */
  async revoke(actor: AuthUser, deviceId: string): Promise<void> {
    const device = await this.findDevice(deviceId);
    if (device.status === 'REVOKED') throw rule('Cet appareil est déjà révoqué.');
    await this.setDeviceStatus(actor, device, 'REVOKED', 'device.revoke');
  }

  /** Blocage temporaire : le téléphone reste associé, mais ne peut plus rien faire. */
  async block(actor: AuthUser, deviceId: string): Promise<void> {
    const device = await this.findDevice(deviceId);
    if (device.status !== 'ACTIVE') throw rule('Seul un appareil actif peut être bloqué.');
    await this.setDeviceStatus(actor, device, 'BLOCKED', 'device.block');
  }

  /** Réactivation d'un appareil bloqué ; l'utilisateur se reconnecte avec son mot de passe. */
  async unblock(actor: AuthUser, deviceId: string): Promise<void> {
    const device = await this.findDevice(deviceId);
    if (device.status !== 'BLOCKED') throw rule("Cet appareil n'est pas bloqué.");
    await this.setDeviceStatus(actor, device, 'ACTIVE', 'device.unblock');
  }

  private async findDevice(deviceId: string): Promise<DeviceRow> {
    const device = await this.db.device.findFirst({ where: { id: deviceId } });
    if (!device) throw notFound('Appareil introuvable.');
    return device;
  }

  private async setDeviceStatus(
    actor: AuthUser,
    device: DeviceRow,
    status: 'ACTIVE' | 'BLOCKED' | 'REVOKED',
    action: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: { status, ...(status === 'REVOKED' ? { revokedAt: new Date() } : {}) },
      });
      if (status !== 'ACTIVE') {
        await tx.session.updateMany({
          where: { deviceId: device.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: `DEVICE_${status}` },
        });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action,
          entity: 'Device',
          entityId: device.id,
          before: { status: device.status },
          after: { status },
        },
        tx,
      );
      // Le téléphone révoqué reçoit un dernier push (BR-NOT-03)
      if (status === 'REVOKED')
        await this.notifications.notify(tx as unknown as Prisma.TransactionClient, {
          companyId: actor.companyId,
          type: 'DEVICE_REVOKED',
          title: 'Appareil révoqué',
          body: 'Ce téléphone a été déconnecté par votre superviseur. Contactez-le pour en associer un autre.',
          data: { deviceId: device.id },
          to: { userIds: [device.userId] },
          actorUserId: actor.userId,
        });
    });
    if (status === 'REVOKED') this.notifications.kick();
  }

  /** Fermeture d'une session : l'utilisateur doit se reconnecter avec son mot de passe. */
  async revokeSession(actor: AuthUser, sessionId: string): Promise<void> {
    const session = await this.db.session.findFirst({
      where: { id: sessionId },
      include: { user: { include: { role: true } } },
    });
    if (!session) throw notFound('Session introuvable.');
    if (session.user.role.channel !== 'MOBILE') {
      throw rule(
        'Une session Web se ferme en désactivant le compte ou en réinitialisant son mot de passe.',
      );
    }
    await this.closeSessions(actor, { id: sessionId }, 'session.revoke', 'Session', sessionId);
  }

  /** Forcer une nouvelle authentification sur le téléphone d'un utilisateur terrain. */
  async revokeUserSessions(actor: AuthUser, userId: string): Promise<void> {
    await this.fieldUser(userId);
    await this.closeSessions(actor, { userId }, 'session.revoke_all', 'User', userId);
  }

  private async closeSessions(
    actor: AuthUser,
    where: Prisma.SessionWhereInput,
    action: string,
    entity: string,
    entityId: string,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { ...where, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'FORCED_LOGOUT' },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action,
          entity,
          entityId,
          after: { closedSessions: count },
        },
        tx,
      );
    });
  }

  /**
   * Signal de vie du téléphone (architecture §11.3) : batterie, opérations en attente, version.
   * La position n'est gardée que pendant une journée en cours (BR-JOU-09).
   */
  async heartbeat(
    user: AuthUser,
    input: z.output<typeof heartbeatSchema>,
  ): Promise<HeartbeatResponse> {
    if (!user.deviceId) throw rule("Le signal de vie vient d'un téléphone associé.");
    const now = new Date();
    const [device, workday, settings] = await Promise.all([
      this.findDevice(user.deviceId),
      input.position
        ? this.db.workday.findFirst({
            where: { userId: user.userId, status: 'IN_PROGRESS', deletedAt: null },
            orderBy: { date: 'desc' },
          })
        : null,
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    const intervalMin = settings
      ? companySettingsSchema.parse(settings.data).positionIntervalMin
      : 5;

    const tooSoon =
      device.lastPositionAt !== null &&
      now.getTime() - device.lastPositionAt.getTime() < MIN_PING_INTERVAL_MS;
    const position = workday && input.position && !tooSoon ? input.position : null;

    await this.db.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: now,
          batteryLevel: input.batteryLevel ?? device.batteryLevel,
          pendingOps: input.pendingOps,
          appVersion: input.appVersion ?? device.appVersion,
          ...(position && {
            lastLatitude: position.latitude,
            lastLongitude: position.longitude,
            lastPositionAt: now,
          }),
        },
      });
      if (position && workday) {
        await tx.devicePing.create({
          data: {
            id: uuidv7(),
            companyId: user.companyId,
            userId: user.userId,
            deviceId: device.id,
            workdayId: workday.id,
            latitude: position.latitude,
            longitude: position.longitude,
            accuracyM: position.accuracyM,
            batteryLevel: input.batteryLevel ?? null,
            pendingOps: input.pendingOps,
            recordedAt: new Date(position.recordedAt),
          },
        });
      }
    });
    return { positionRecorded: position !== null, intervalMin };
  }

  /** Jeton de notification push du téléphone. */
  async setPushToken(user: AuthUser, pushToken: string): Promise<void> {
    if (!user.deviceId) throw rule("Le jeton push vient d'un téléphone associé.");
    await this.db.device.update({ where: { id: user.deviceId }, data: { pushToken } });
  }
}
