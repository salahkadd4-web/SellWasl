import { Inject, Injectable } from '@nestjs/common';
import {
  type CompensationDto,
  companySettingsSchema,
  type createCompensationSchema,
  type CurrentCompensationDto,
  type PayrollSettings,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { personOf } from '../accounting/discrepancies.service';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, frDate, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { audit, payrollSettings, type Tx, WITH_ROLE } from './payroll-common';

const DETAIL = { user: WITH_ROLE } satisfies Prisma.EmployeeCompensationInclude;
type Row = Prisma.EmployeeCompensationGetPayload<{ include: typeof DETAIL }>;

export const toCompensationDto = (r: Row): CompensationDto => ({
  id: r.id,
  user: personOf(r.user),
  baseSalary: Number(r.baseSalary),
  effectiveFrom: dateOnly(r.effectiveFrom),
  effectiveTo: r.effectiveTo ? dateOnly(r.effectiveTo) : null,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Rémunération des employés et paramètres de paie (phase 21 bis) : un nouveau salaire ferme le
 * précédent, l'historique reste.
 */
@Injectable()
export class CompensationService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly auditService: AuditService,
  ) {}

  async list(userId?: string): Promise<CompensationDto[]> {
    const rows = await this.db.employeeCompensation.findMany({
      where: { deletedAt: null, ...(userId && { userId }) },
      include: DETAIL,
      orderBy: [{ userId: 'asc' }, { effectiveFrom: 'desc' }],
    });
    return rows.map(toCompensationDto);
  }

  /** Salaire en vigueur aujourd'hui de chaque utilisateur actif. */
  async current(today: string): Promise<CurrentCompensationDto[]> {
    const [users, rows] = await Promise.all([
      this.db.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE' },
        include: { role: true },
        orderBy: { code: 'asc' },
      }),
      this.db.employeeCompensation.findMany({
        where: {
          deletedAt: null,
          effectiveFrom: { lte: toDate(today) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: toDate(today) } }],
        },
        include: DETAIL,
      }),
    ]);
    return users.map((u) => {
      const current = rows.find((r) => r.userId === u.id);
      return { user: personOf(u), current: current ? toCompensationDto(current) : null };
    });
  }

  async create(
    actor: AuthUser,
    input: z.output<typeof createCompensationSchema>,
  ): Promise<CompensationDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const user = await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } });
      if (!user) throw notFound('Employé introuvable.');
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${input.userId}::uuid FOR UPDATE`;
      const latest = await tx.employeeCompensation.findFirst({
        where: { userId: input.userId, deletedAt: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      const from = toDate(input.effectiveFrom);
      if (latest && from <= latest.effectiveFrom)
        throw rule(
          `La nouvelle rémunération doit commencer après la précédente (${frDate(dateOnly(latest.effectiveFrom))}).`,
        );
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= from))
        await tx.employeeCompensation.update({
          where: { id: latest.id },
          data: { effectiveTo: new Date(from.getTime() - 86_400_000), version: { increment: 1 } },
        });
      await tx.employeeCompensation.create({
        data: {
          id,
          companyId: actor.companyId,
          userId: input.userId,
          baseSalary: BigInt(input.baseSalary),
          effectiveFrom: from,
          note: input.note || null,
          createdByUserId: actor.userId,
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'compensation.create',
        'EmployeeCompensation',
        id,
        latest
          ? { baseSalary: Number(latest.baseSalary), effectiveFrom: dateOnly(latest.effectiveFrom) }
          : undefined,
        { userId: input.userId, baseSalary: input.baseSalary, effectiveFrom: input.effectiveFrom },
      );
    });
    const row = await this.db.employeeCompensation.findFirstOrThrow({
      where: { id },
      include: DETAIL,
    });
    return toCompensationDto(row);
  }

  settings(): Promise<PayrollSettings> {
    return payrollSettings(this.db as unknown as Tx);
  }

  async putSettings(actor: AuthUser, input: PayrollSettings): Promise<PayrollSettings> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
      const data = companySettingsSchema.parse(row?.data ?? {});
      await tx.companySettings.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          version: (row?.version ?? 0) + 1,
          data: { ...data, payroll: input },
          createdByUserId: actor.userId,
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'payroll.settings',
        'CompanySettings',
        null,
        data.payroll,
        input,
      );
    });
    return this.settings();
  }
}
