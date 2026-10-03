import { Injectable } from '@nestjs/common';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  companyId: string;
  actorUserId: string | null;
  deviceId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

/** Journal d'audit de l'entreprise, en ajout seul (BR-AUD-01). */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({ data: { id: uuidv7(), ...entry } });
  }
}
