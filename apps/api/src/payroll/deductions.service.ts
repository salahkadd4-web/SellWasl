import { Inject, Injectable } from '@nestjs/common';
import type {
  createDeductionSchema,
  DeductionDto,
  deductionsQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { conflict, personOf } from '../accounting/discrepancies.service';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { audit, monthOf, namesOf, type Tx, WITH_ROLE } from './payroll-common';

const DETAIL = { user: WITH_ROLE } satisfies Prisma.PayrollDeductionInclude;
type Row = Prisma.PayrollDeductionGetPayload<{ include: typeof DETAIL }>;

/**
 * Retenues sur rémunération (phase 21 bis) : en attente, approuvées explicitement par le
 * comptable, puis appliquées à l'approbation de la paie. L'écart d'origine suit leur statut.
 */
@Injectable()
export class DeductionsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly auditService: AuditService,
  ) {}

  async list(q: z.output<typeof deductionsQuerySchema>): Promise<DeductionDto[]> {
    const rows = await this.db.payrollDeduction.findMany({
      where: {
        deletedAt: null,
        ...(q.userId && { userId: q.userId }),
        ...(q.status && { status: q.status }),
      },
      include: DETAIL,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return this.toDtos(rows);
  }

  /** Retenue libre (motif obligatoire), en attente d'approbation comme les autres. */
  async create(
    actor: AuthUser,
    input: z.output<typeof createDeductionSchema>,
  ): Promise<DeductionDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      if (!(await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } })))
        throw notFound('Employé introuvable.');
      await tx.payrollDeduction.create({
        data: {
          id,
          companyId: actor.companyId,
          userId: input.userId,
          amount: BigInt(input.amount),
          reason: input.reason,
          sourceType: 'OTHER',
          month: input.month ? toDate(`${input.month}-01`) : null,
          createdByUserId: actor.userId,
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'deduction.create',
        'PayrollDeduction',
        id,
        undefined,
        {
          userId: input.userId,
          amount: input.amount,
          reason: input.reason,
        },
      );
    });
    return this.get(id);
  }

  async approve(actor: AuthUser, id: string): Promise<DeductionDto> {
    await this.decide(actor, id, 'APPROVED');
    return this.get(id);
  }

  async reject(actor: AuthUser, id: string, note?: string): Promise<DeductionDto> {
    await this.decide(actor, id, 'REJECTED', note);
    return this.get(id);
  }

  private async decide(
    actor: AuthUser,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.$queryRaw`SELECT id FROM payroll_deduction WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.payrollDeduction.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw notFound('Retenue introuvable.');
      if (row.status !== 'PENDING') throw conflict('Cette retenue est déjà décidée.');
      await tx.payrollDeduction.update({
        where: { id },
        data: {
          status,
          approvedByUserId: actor.userId,
          approvedAt: new Date(),
          version: { increment: 1 },
        },
      });
      // L'écart d'origine : retenue approuvée, ou refusée (l'écart est alors résolu sans retenue)
      if (row.discrepancyId)
        await tx.discrepancy.update({
          where: { id: row.discrepancyId },
          data: {
            status: status === 'APPROVED' ? 'DEDUCTION_APPROVED' : 'RESOLVED',
            version: { increment: 1 },
          },
        });
      await audit(
        this.auditService,
        tx,
        actor,
        status === 'APPROVED' ? 'deduction.approve' : 'deduction.reject',
        'PayrollDeduction',
        id,
        { status: row.status },
        { status, amount: Number(row.amount), note: note ?? null },
      );
    });
  }

  async get(id: string): Promise<DeductionDto> {
    const row = await this.db.payrollDeduction.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL,
    });
    if (!row) throw notFound('Retenue introuvable.');
    return (await this.toDtos([row]))[0]!;
  }

  async toDtos(rows: Row[]): Promise<DeductionDto[]> {
    const name = await namesOf(
      this.db as unknown as Tx,
      rows.map((r) => r.approvedByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      user: personOf(r.user),
      amount: Number(r.amount),
      reason: r.reason,
      sourceType: r.sourceType,
      discrepancyId: r.discrepancyId,
      month: r.month ? monthOf(r.month) : null,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      approvedBy: name(r.approvedByUserId),
      approvedAt: r.approvedAt?.toISOString() ?? null,
      appliedAt: r.appliedAt?.toISOString() ?? null,
    }));
  }
}
