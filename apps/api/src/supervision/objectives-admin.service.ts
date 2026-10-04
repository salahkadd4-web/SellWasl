import { Inject, Injectable } from '@nestjs/common';
import type { ObjectiveDto, putObjectivesSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { rule, toDate } from '../field/field-errors';
import { ObjectivesService } from '../field/objectives.service';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];

/** Objectifs mensuels par vendeur et gamme, fixés par le superviseur (BR-OBJ-01, UC-56). */
@Injectable()
export class ObjectivesAdminService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly objectives: ObjectivesService,
    private readonly audit: AuditService,
  ) {}

  async list(month: string, userId?: string): Promise<ObjectiveDto[]> {
    const rows = await this.objectives.forMonth(month, userId);
    const users = await this.db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    });
    return rows
      .map(({ userId, ...o }) => {
        const u = users.find((x) => x.id === userId)!;
        return { ...o, user: { id: u.id, code: u.code, name: `${u.firstName} ${u.lastName}` } };
      })
      .sort(
        (a, b) =>
          a.user.code.localeCompare(b.user.code) || a.range.name.localeCompare(b.range.name),
      );
  }

  async put(actor: AuthUser, input: z.output<typeof putObjectivesSchema>): Promise<ObjectiveDto[]> {
    const month = toDate(`${input.month}-01`);
    const [sellers, ranges] = await Promise.all([
      this.db.user.findMany({
        where: {
          id: { in: input.entries.map((e) => e.userId) },
          deletedAt: null,
          role: { code: { in: SELLER_ROLES as ('PRE_VENDEUR' | 'VENDEUR_CASH_VAN')[] } },
        },
      }),
      this.db.productRange.findMany({
        where: { id: { in: input.entries.map((e) => e.rangeId) }, deletedAt: null },
      }),
    ]);
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      for (const e of input.entries) {
        if (!sellers.some((s) => s.id === e.userId)) throw rule('Vendeur introuvable.');
        if (!ranges.some((r) => r.id === e.rangeId)) throw rule('Gamme introuvable.');
        const values = {
          targetAmount: BigInt(e.targetAmount),
          bonusAmount: BigInt(e.bonusAmount),
          capPercent: e.capPercent,
          deletedAt: null,
        };
        await tx.objective.upsert({
          where: {
            companyId_userId_rangeId_month: {
              companyId: actor.companyId,
              userId: e.userId,
              rangeId: e.rangeId,
              month,
            },
          },
          create: {
            id: uuidv7(),
            companyId: actor.companyId,
            userId: e.userId,
            rangeId: e.rangeId,
            month,
            createdByUserId: actor.userId,
            ...values,
          },
          update: { ...values, version: { increment: 1 } },
        });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'objective.update',
          entity: 'Objective',
          after: { month: input.month, entries: input.entries.length },
        },
        tx,
      );
    });
    return this.list(input.month);
  }
}
