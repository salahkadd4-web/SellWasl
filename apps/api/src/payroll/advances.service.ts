import { Inject, Injectable } from '@nestjs/common';
import { advanceRemaining } from '@sellwasl/business-rules';
import type { AdvanceDto, advancesQuerySchema, createAdvanceSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { conflict, personOf } from '../accounting/discrepancies.service';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import {
  assertPayrollEnabled,
  audit,
  monthOf,
  namesOf,
  payrollSettings,
  salaryFor,
  type Tx,
  WITH_ROLE,
} from './payroll-common';

const DETAIL = { user: WITH_ROLE } satisfies Prisma.SalaryAdvanceInclude;
type Row = Prisma.SalaryAdvanceGetPayload<{ include: typeof DETAIL }>;

/**
 * Acomptes (phase 21 bis) : demandés, approuvés dans le plafond du salaire du mois, payés, puis
 * déduits à l'approbation de la paie. Désactivés : aucune création, l'historique reste.
 */
@Injectable()
export class AdvancesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly auditService: AuditService,
  ) {}

  async list(q: z.output<typeof advancesQuerySchema>): Promise<AdvanceDto[]> {
    const rows = await this.db.salaryAdvance.findMany({
      where: {
        deletedAt: null,
        ...(q.userId && { userId: q.userId }),
        ...(q.status && { status: q.status }),
        ...(q.month && { month: toDate(`${q.month}-01`) }),
      },
      include: DETAIL,
      orderBy: { requestedAt: 'desc' },
      take: 500,
    });
    return this.toDtos(rows);
  }

  async create(actor: AuthUser, input: z.output<typeof createAdvanceSchema>): Promise<AdvanceDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const settings = await assertPayrollEnabled(tx);
      if (!settings.advancesEnabled) throw rule('Les acomptes sont désactivés.');
      if (!(await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } })))
        throw notFound('Employé introuvable.');
      await tx.salaryAdvance.create({
        data: {
          id,
          companyId: actor.companyId,
          userId: input.userId,
          month: toDate(`${input.month}-01`),
          amount: BigInt(input.amount),
          reason: input.reason || null,
          createdByUserId: actor.userId,
        },
      });
      await audit(this.auditService, tx, actor, 'advance.create', 'SalaryAdvance', id, undefined, {
        userId: input.userId,
        month: input.month,
        amount: input.amount,
      });
    });
    return this.get(id);
  }

  /** Approbation : employé rémunéré ce mois-là, total des acomptes dans le plafond, paie ouverte. */
  async approve(actor: AuthUser, id: string): Promise<AdvanceDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await this.lock(tx, id);
      if (row.status !== 'REQUESTED') throw conflict('Cet acompte est déjà traité.');
      const month = monthOf(row.month);
      const settings = await payrollSettings(tx);
      const salary = await salaryFor(tx, row.userId, month);
      if (!salary) throw rule("Cet employé n'a pas de rémunération ce mois-là.");
      await this.assertMonthOpen(tx, row.month);
      const others = await tx.salaryAdvance.aggregate({
        where: {
          userId: row.userId,
          month: row.month,
          id: { not: row.id },
          status: { in: ['APPROVED', 'PAID', 'DEDUCTED'] },
          deletedAt: null,
        },
        _sum: { amount: true },
      });
      const remaining = advanceRemaining({
        baseSalary: Number(salary.baseSalary),
        maxPercent: settings.advanceMaxPercent,
        alreadyRequested: Number(others._sum.amount ?? 0n),
      });
      if (Number(row.amount) > remaining)
        throw rule(
          `Acompte au-delà du plafond (${settings.advanceMaxPercent} % du salaire) : il reste ${remaining} DA.`,
          { remaining },
        );
      await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'advance.approve',
        'SalaryAdvance',
        id,
        { status: row.status },
        {
          status: 'APPROVED',
        },
      );
    });
    return this.get(id);
  }

  async reject(actor: AuthUser, id: string, note?: string): Promise<AdvanceDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await this.lock(tx, id);
      if (row.status !== 'REQUESTED' && row.status !== 'APPROVED')
        throw conflict('Un acompte payé ou déjà refusé ne peut plus être refusé.');
      await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'advance.reject',
        'SalaryAdvance',
        id,
        { status: row.status },
        {
          status: 'REJECTED',
          note: note ?? null,
        },
      );
    });
    return this.get(id);
  }

  /** Paiement de l'acompte approuvé : une seule fois. */
  async pay(actor: AuthUser, id: string): Promise<AdvanceDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await this.lock(tx, id);
      if (row.status !== 'APPROVED')
        throw conflict(
          row.status === 'REQUESTED'
            ? "Approuvez d'abord l'acompte."
            : 'Cet acompte est déjà payé ou refusé.',
        );
      await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'PAID',
          paidByUserId: actor.userId,
          paidAt: new Date(),
          version: { increment: 1 },
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'advance.pay',
        'SalaryAdvance',
        id,
        { status: row.status },
        {
          status: 'PAID',
          amount: Number(row.amount),
        },
      );
    });
    return this.get(id);
  }

  private async assertMonthOpen(tx: Tx, month: Date) {
    const period = await tx.payrollPeriod.findFirst({ where: { month, deletedAt: null } });
    if (period && !['OPEN', 'CALCULATED'].includes(period.status))
      throw rule('La paie de ce mois est déjà approuvée : choisissez le mois suivant.');
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM salary_advance WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.salaryAdvance.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('Acompte introuvable.');
    return row;
  }

  async get(id: string): Promise<AdvanceDto> {
    const row = await this.db.salaryAdvance.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL,
    });
    if (!row) throw notFound('Acompte introuvable.');
    return (await this.toDtos([row]))[0]!;
  }

  async toDtos(rows: Row[]): Promise<AdvanceDto[]> {
    const name = await namesOf(
      this.db as unknown as Tx,
      rows.map((r) => r.decidedByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      user: personOf(r.user),
      month: monthOf(r.month),
      amount: Number(r.amount),
      reason: r.reason,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      decidedBy: name(r.decidedByUserId),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
    }));
  }
}
