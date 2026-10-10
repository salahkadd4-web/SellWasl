import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditEntity } from '@sellwasl/validation';
import { ClsService } from 'nestjs-cls';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  companyId: string;
  actorUserId: string | null;
  deviceId?: string | null;
  /** Code du catalogue (packages/validation, docs/audit.md) : une action sans libellé ne compile pas. */
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditWriter {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> };
}

/** Clé du contexte de requête : IP, navigateur et appareil de l'auteur (phase 26). */
export const AUDIT_CONTEXT = 'auditContext';

export interface AuditContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string | null;
}

/** Journal d'audit de l'entreprise, en ajout seul (BR-AUD-01). */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  /**
   * tx : client de transaction, filtré par entreprise ou non. IP, navigateur et appareil viennent
   * de la requête en cours quand l'appel ne les donne pas ; hors requête, ils restent vides.
   */
  async write(entry: AuditEntry, tx: AuditWriter = this.prisma): Promise<void> {
    const context = this.cls.isActive()
      ? this.cls.get<AuditContext | undefined>(AUDIT_CONTEXT)
      : undefined;
    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        ip: context?.ip,
        userAgent: context?.userAgent,
        ...entry,
        deviceId: entry.deviceId !== undefined ? entry.deviceId : (context?.deviceId ?? null),
      },
    });
  }
}
