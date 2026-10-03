import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ACTIVATION_CODE_ALPHABET,
  activationQrPayload,
  type ActivationCodeResponse,
} from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { hashActivationCode } from '../auth/auth.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';

/** Validité d'un code d'association (ARC-04). */
const ACTIVATION_CODE_TTL_MS = 10 * 60 * 1000;

export interface FieldUserDevice {
  userId: string;
  code: string;
  name: string;
  role: string;
  device: {
    id: string;
    series: string;
    status: string;
    model: string | null;
    lastSeenAt: string | null;
    pendingOps: number;
  } | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Utilisateurs terrain de l'entreprise et leur appareil actif (UC-59). */
  async listFieldUsers(companyId: string): Promise<FieldUserDevice[]> {
    const users = await this.prisma.user.findMany({
      where: { companyId, deletedAt: null, role: { channel: 'MOBILE' } },
      include: { role: true, devices: { where: { status: { in: ['ACTIVE', 'BLOCKED'] } } } },
      orderBy: { code: 'asc' },
    });
    return users.map((u) => {
      const d = u.devices[0];
      return {
        userId: u.id,
        code: u.code,
        name: `${u.firstName} ${u.lastName}`,
        role: u.role.name,
        device: d
          ? {
              id: d.id,
              series: d.series,
              status: d.status,
              model: d.model,
              lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
              pendingOps: d.pendingOps,
            }
          : null,
      };
    });
  }

  /** Code d'association à usage unique, valable 10 minutes (ARC-04, BR-USR-07, BR-USR-08). */
  async createActivationCode(actor: AuthUser, userId: string): Promise<ActivationCodeResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId: actor.companyId, deletedAt: null },
      include: { role: true, devices: { where: { status: 'ACTIVE' } } },
    });
    if (!user) throw notFound('Utilisateur introuvable.');
    if (user.role.channel !== 'MOBILE') {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BUSINESS_RULE',
        'Seuls les utilisateurs terrain utilisent un appareil.',
        { rule: 'BR-USR-02' },
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BUSINESS_RULE',
        'Ce compte est désactivé.',
      );
    }

    const code = Array.from(
      { length: 8 },
      () => ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)],
    ).join('');
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Un seul code valable à la fois par utilisateur
      await tx.deviceActivationCode.updateMany({
        where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date() },
      });
      await tx.deviceActivationCode.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
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

  /** Révocation d'un appareil et de ses sessions (UC-59). */
  async revoke(actor: AuthUser, deviceId: string): Promise<void> {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, companyId: actor.companyId },
    });
    if (!device) throw notFound('Appareil introuvable.');
    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id: deviceId },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { deviceId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'DEVICE_REVOKED' },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'device.revoke',
          entity: 'Device',
          entityId: deviceId,
        },
        tx,
      );
    });
  }
}
