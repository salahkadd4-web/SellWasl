import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { installments, type PayLineKind, payTotals } from '@sellwasl/business-rules';
import type {
  createAdjustmentSchema,
  MyPayDto,
  PayrollAdjustmentDto,
  PayrollDashboardDto,
  PayrollEntryDto,
  PayrollPeriodDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { conflict, personOf } from '../accounting/discrepancies.service';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, frDate, rule, toDate } from '../field/field-errors';
import { ObjectivesService } from '../field/objectives.service';
import type { Prisma } from '../generated/prisma/client';
import { DriverObjectivesService } from '../supervision/driver-objectives.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { AdvancesService } from './advances.service';
import { toCompensationDto } from './compensation.service';
import { DeductionsService } from './deductions.service';
import { IncentivesService } from './incentives.service';
import {
  type Actor,
  assertPayrollEnabled,
  audit,
  monthOf,
  monthRange,
  namesOf,
  payrollSettings,
  salaryFor,
  shiftMonth,
  type Tx,
  WITH_ROLE,
} from './payroll-common';

const ENTRY = {
  user: WITH_ROLE,
  lines: { orderBy: { createdAt: 'asc' as const } },
  payments: { orderBy: { installment: 'asc' as const } },
} satisfies Prisma.PayrollEntryInclude;
type EntryRow = Prisma.PayrollEntryGetPayload<{ include: typeof ENTRY }>;

interface NewLine {
  kind: PayLineKind;
  label: string;
  amount: number;
  sourceType: string | null;
  sourceId: string | null;
}

const fr = (d: Date) => frDate(dateOnly(d));

/**
 * Paie mensuelle interne (phase 21 bis) : calcul centralisé (salaire, primes, objectifs,
 * ajustements, acomptes, retenues), chaque ligne avec sa source ; approbation, échéances payées
 * une seule fois, clôture sans retour. Une paie clôturée se corrige par un ajustement du mois
 * suivant.
 */
@Injectable()
export class PayrollService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly auditService: AuditService,
    private readonly objectives: ObjectivesService,
    private readonly driverObjectives: DriverObjectivesService,
    private readonly incentives: IncentivesService,
    private readonly advances: AdvancesService,
    private readonly deductions: DeductionsService,
  ) {}

  async periods(): Promise<PayrollPeriodDto[]> {
    const rows = await this.db.payrollPeriod.findMany({
      where: { deletedAt: null },
      orderBy: { month: 'desc' },
      take: 36,
    });
    const out: PayrollPeriodDto[] = [];
    for (const r of rows) out.push(await this.get(r.id, false));
    return out;
  }

  async create(actor: Actor, month: string): Promise<PayrollPeriodDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await assertPayrollEnabled(tx);
      if (
        await tx.payrollPeriod.findFirst({
          where: { month: toDate(`${month}-01`), deletedAt: null },
        })
      )
        throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', 'La paie de ce mois existe déjà.');
      await tx.payrollPeriod.create({
        data: {
          id,
          companyId: actor.companyId,
          month: toDate(`${month}-01`),
          createdByUserId: actor.userId,
        },
      });
      await audit(this.auditService, tx, actor, 'payroll.create', 'PayrollPeriod', id, undefined, {
        month,
      });
    });
    return this.get(id);
  }

  async get(id: string, withEntries = true): Promise<PayrollPeriodDto> {
    const period = await this.db.payrollPeriod.findFirst({ where: { id, deletedAt: null } });
    if (!period) throw notFound('Paie introuvable.');
    const entries = await this.db.payrollEntry.findMany({
      where: { periodId: id, deletedAt: null },
      include: ENTRY,
      orderBy: { user: { code: 'asc' } },
    });
    const dtos = await this.entryDtos(entries);
    const sum = (f: (e: PayrollEntryDto) => number) => dtos.reduce((s, e) => s + f(e), 0);
    return {
      id: period.id,
      month: monthOf(period.month),
      status: period.status,
      calculatedAt: period.calculatedAt?.toISOString() ?? null,
      approvedAt: period.approvedAt?.toISOString() ?? null,
      paidAt: period.paidAt?.toISOString() ?? null,
      closedAt: period.closedAt?.toISOString() ?? null,
      totals: {
        employees: dtos.length,
        baseSalary: sum((e) => e.baseSalary),
        earnings: sum((e) => e.earnings),
        advances: sum((e) => e.advances),
        deductions: sum((e) => e.deductions),
        net: sum((e) => e.net),
        paid: sum((e) => e.payments.filter((p) => p.paidAt).reduce((s, p) => s + p.amount, 0)),
      },
      entries: withEntries ? dtos : [],
    };
  }

  /** Verrouille la période pour toute la transaction : pas de double calcul ni double approbation. */
  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM payroll_period WHERE id = ${id}::uuid FOR UPDATE`;
    const period = await tx.payrollPeriod.findFirst({ where: { id, deletedAt: null } });
    if (!period) throw notFound('Paie introuvable.');
    return period;
  }

  /** Calcul (ou recalcul) : remplace les fiches tant que la paie n'est pas approuvée. */
  async calculate(actor: Actor, id: string): Promise<PayrollPeriodDto> {
    await this.db.$transaction(
      async (tenantTx) => {
        const tx = tenantTx as unknown as Tx;
        const period = await this.lock(tx, id);
        if (period.status !== 'OPEN' && period.status !== 'CALCULATED')
          throw conflict('Cette paie est approuvée : elle ne se recalcule plus.');
        const month = monthOf(period.month);
        await tx.payrollEntry.deleteMany({ where: { periodId: id } });
        const users = await this.employees(tx, month);
        let total = 0;
        for (const userId of users) {
          const lines = await this.linesFor(tx, userId, month);
          if (lines.length === 0) continue;
          const totals = payTotals(lines);
          total += totals.net;
          const entryId = uuidv7();
          await tx.payrollEntry.create({
            data: {
              id: entryId,
              companyId: actor.companyId,
              periodId: id,
              userId,
              baseSalary: BigInt(totals.baseSalary),
              earnings: BigInt(totals.earnings),
              advances: BigInt(totals.advances),
              deductions: BigInt(totals.deductions),
              net: BigInt(totals.net),
              createdByUserId: actor.userId,
            },
          });
          await tx.payrollLine.createMany({
            data: lines.map((l) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              entryId,
              kind: l.kind,
              label: l.label,
              amount: BigInt(l.amount),
              sourceType: l.sourceType,
              sourceId: l.sourceId,
            })),
          });
        }
        await tx.payrollPeriod.update({
          where: { id },
          data: {
            status: 'CALCULATED',
            calculatedAt: new Date(),
            calculatedByUserId: actor.userId,
            version: { increment: 1 },
          },
        });
        await audit(
          this.auditService,
          tx,
          actor,
          'payroll.calculate',
          'PayrollPeriod',
          id,
          { status: period.status },
          {
            status: 'CALCULATED',
            employees: users.length,
            net: total,
          },
        );
      },
      { timeout: 60_000 },
    );
    return this.get(id);
  }

  /** Employés rémunérés pendant le mois. */
  private async employees(tx: Tx, month: string): Promise<string[]> {
    const { start, end } = monthRange(month);
    const rows = await tx.employeeCompensation.findMany({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: end },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  /** Lignes d'une fiche, chacune avec sa source. */
  private async linesFor(tx: Tx, userId: string, month: string): Promise<NewLine[]> {
    const { start, end } = monthRange(month);
    const salary = await salaryFor(tx, userId, month);
    if (!salary) return [];
    const lines: NewLine[] = [
      {
        kind: 'BASE_SALARY',
        label: 'Salaire de base',
        amount: Number(salary.baseSalary),
        sourceType: 'EmployeeCompensation',
        sourceId: salary.id,
      },
    ];
    const incentives = await tx.incentive.findMany({
      where: {
        userId,
        status: 'VALIDATED',
        payrollPeriodId: null,
        periodEnd: { gte: start, lte: end },
        deletedAt: null,
      },
      include: { rule: true },
      orderBy: { periodStart: 'asc' },
    });
    for (const i of incentives)
      lines.push({
        kind: 'INCENTIVE',
        label: `Prime « ${i.rule.name} » du ${fr(i.periodStart)} au ${fr(i.periodEnd)}`,
        amount: Number(i.amount),
        sourceType: 'Incentive',
        sourceId: i.id,
      });
    // Objectifs mensuels du mois versé (décalage réglé par l'entreprise)
    const settingsRow = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
    const delay = Number(
      (settingsRow?.data as { objectivePaymentDelayMonths?: number })
        ?.objectivePaymentDelayMonths ?? 0,
    );
    const objectiveMonth = shiftMonth(month, -delay);
    for (const o of await this.objectives.forMonth(objectiveMonth, userId))
      if (o.estimatedBonus > 0)
        lines.push({
          kind: 'OBJECTIVE_BONUS',
          label: `Objectif ${o.range.name} de ${objectiveMonth}`,
          amount: o.estimatedBonus,
          sourceType: 'Objective',
          sourceId: o.id,
        });
    for (const d of await this.driverObjectives.list(objectiveMonth, userId))
      if (d.estimatedBonus > 0)
        lines.push({
          kind: 'DRIVER_BONUS',
          label: `Objectif du livreur de ${objectiveMonth}`,
          amount: d.estimatedBonus,
          sourceType: 'DriverObjective',
          sourceId: null,
        });
    const adjustments = await tx.payrollAdjustment.findMany({
      where: { userId, month: start, payrollPeriodId: null, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    for (const a of adjustments)
      lines.push({
        kind: 'ADJUSTMENT',
        label: `Ajustement : ${a.reason}`,
        amount: Number(a.amount),
        sourceType: 'PayrollAdjustment',
        sourceId: a.id,
      });
    const advances = await tx.salaryAdvance.findMany({
      where: { userId, month: start, status: 'PAID', deletedAt: null },
      orderBy: { paidAt: 'asc' },
    });
    for (const a of advances)
      lines.push({
        kind: 'ADVANCE',
        label: `Acompte du ${fr(a.paidAt ?? a.requestedAt)}`,
        amount: -Number(a.amount),
        sourceType: 'SalaryAdvance',
        sourceId: a.id,
      });
    const deductions = await tx.payrollDeduction.findMany({
      where: {
        userId,
        status: 'APPROVED',
        payrollPeriodId: null,
        deletedAt: null,
        OR: [{ month: null }, { month: start }],
      },
      orderBy: { createdAt: 'asc' },
    });
    for (const d of deductions)
      lines.push({
        kind: 'DEDUCTION',
        label: `Retenue : ${d.reason}`,
        amount: -Number(d.amount),
        sourceType: 'PayrollDeduction',
        sourceId: d.id,
      });
    return lines;
  }

  /**
   * Approbation : chaque source passe à « appliquée » (une seule fois : une source déjà prise
   * ailleurs oblige à recalculer), échéances créées selon le calendrier de l'entreprise.
   */
  async approve(actor: AuthUser, id: string): Promise<PayrollPeriodDto> {
    await this.db.$transaction(
      async (tenantTx) => {
        const tx = tenantTx as unknown as Tx;
        const period = await this.lock(tx, id);
        if (period.status !== 'CALCULATED')
          throw conflict(
            period.status === 'OPEN'
              ? "Calculez d'abord la paie."
              : 'Cette paie est déjà approuvée.',
          );
        const settings = await payrollSettings(tx);
        const month = monthOf(period.month);
        const entries = await tx.payrollEntry.findMany({
          where: { periodId: id },
          include: { lines: true, user: true },
        });
        const negative = entries.find((e) => e.net < 0n);
        if (negative)
          throw rule(
            `Net négatif pour ${negative.user.firstName} ${negative.user.lastName} : reportez une retenue ou ajustez.`,
          );
        const now = new Date();
        const ids = (type: string) =>
          entries.flatMap((e) =>
            e.lines.filter((l) => l.sourceType === type && l.sourceId).map((l) => l.sourceId!),
          );
        const changed = async (count: Promise<{ count: number }>, expected: number) => {
          if ((await count).count !== expected)
            throw conflict(
              'Une prime, un acompte ou une retenue a changé depuis le calcul : recalculez la paie.',
            );
        };
        const incentiveIds = ids('Incentive');
        await changed(
          tx.incentive.updateMany({
            where: { id: { in: incentiveIds }, status: 'VALIDATED', payrollPeriodId: null },
            data: { status: 'APPLIED', appliedAt: now, payrollPeriodId: id },
          }),
          incentiveIds.length,
        );
        const advanceIds = ids('SalaryAdvance');
        await changed(
          tx.salaryAdvance.updateMany({
            where: { id: { in: advanceIds }, status: 'PAID' },
            data: { status: 'DEDUCTED', deductedAt: now, payrollPeriodId: id },
          }),
          advanceIds.length,
        );
        const deductionIds = ids('PayrollDeduction');
        await changed(
          tx.payrollDeduction.updateMany({
            where: { id: { in: deductionIds }, status: 'APPROVED', payrollPeriodId: null },
            data: { status: 'APPLIED', appliedAt: now, payrollPeriodId: id },
          }),
          deductionIds.length,
        );
        await tx.discrepancy.updateMany({
          where: { deduction: { id: { in: deductionIds } } },
          data: { status: 'DEDUCTION_APPLIED' },
        });
        const adjustmentIds = ids('PayrollAdjustment');
        await changed(
          tx.payrollAdjustment.updateMany({
            where: { id: { in: adjustmentIds }, payrollPeriodId: null },
            data: { payrollPeriodId: id },
          }),
          adjustmentIds.length,
        );
        for (const e of entries)
          await tx.payrollPayment.createMany({
            data: installments(Number(e.net), settings.schedule, month).map((i) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              entryId: e.id,
              installment: i.installment,
              dueDate: toDate(i.dueDate),
              percent: i.percent,
              amount: BigInt(i.amount),
            })),
          });
        await tx.payrollPeriod.update({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedAt: now,
            approvedByUserId: actor.userId,
            version: { increment: 1 },
          },
        });
        await audit(
          this.auditService,
          tx,
          actor,
          'payroll.approve',
          'PayrollPeriod',
          id,
          { status: period.status },
          {
            status: 'APPROVED',
            net: entries.reduce((s, e) => s + Number(e.net), 0),
            schedule: settings.schedule,
          },
        );
      },
      { timeout: 60_000 },
    );
    return this.get(id);
  }

  /** Paiement d'une échéance : une seule fois ; toutes payées, la paie est payée. */
  async pay(actor: AuthUser, paymentId: string): Promise<PayrollPeriodDto> {
    const payment = await this.db.payrollPayment.findFirst({
      where: { id: paymentId, deletedAt: null },
      include: { entry: true },
    });
    if (!payment) throw notFound('Échéance introuvable.');
    const periodId = payment.entry.periodId;
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const period = await this.lock(tx, periodId);
      if (period.status !== 'APPROVED')
        throw conflict("La paie n'est pas à payer (approuvez-la, ou elle est déjà payée).");
      const fresh = await tx.payrollPayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (fresh.paidAt) throw conflict('Cette échéance est déjà payée.');
      const now = new Date();
      await tx.payrollPayment.update({
        where: { id: paymentId },
        data: { paidAt: now, paidByUserId: actor.userId, version: { increment: 1 } },
      });
      const unpaid = await tx.payrollPayment.count({
        where: { entry: { periodId }, paidAt: null, deletedAt: null },
      });
      if (unpaid === 0)
        await tx.payrollPeriod.update({
          where: { id: periodId },
          data: { status: 'PAID', paidAt: now, version: { increment: 1 } },
        });
      await audit(
        this.auditService,
        tx,
        actor,
        'payroll.pay',
        'PayrollPayment',
        paymentId,
        { paidAt: null },
        {
          amount: Number(fresh.amount),
          installment: fresh.installment,
          periodPaid: unpaid === 0,
        },
      );
    });
    return this.get(periodId);
  }

  async close(actor: AuthUser, id: string): Promise<PayrollPeriodDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const period = await this.lock(tx, id);
      if (period.status !== 'PAID') throw conflict('Seule une paie entièrement payée se clôture.');
      await tx.payrollPeriod.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedByUserId: actor.userId,
          version: { increment: 1 },
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'payroll.close',
        'PayrollPeriod',
        id,
        { status: period.status },
        {
          status: 'CLOSED',
        },
      );
    });
    return this.get(id);
  }

  async adjustments(month?: string): Promise<PayrollAdjustmentDto[]> {
    const rows = await this.db.payrollAdjustment.findMany({
      where: { deletedAt: null, ...(month && { month: toDate(`${month}-01`) }) },
      include: { user: WITH_ROLE },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return rows.map((a) => ({
      id: a.id,
      user: personOf(a.user),
      month: monthOf(a.month),
      amount: Number(a.amount),
      reason: a.reason,
      applied: a.payrollPeriodId !== null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  /** Correction contrôlée : seulement pour un mois dont la paie n'est pas approuvée. */
  async createAdjustment(
    actor: AuthUser,
    input: z.output<typeof createAdjustmentSchema>,
  ): Promise<PayrollAdjustmentDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const month = toDate(`${input.month}-01`);
      const period = await tx.payrollPeriod.findFirst({ where: { month, deletedAt: null } });
      if (period) await this.lock(tx, period.id);
      if (period && period.status !== 'OPEN' && period.status !== 'CALCULATED')
        throw conflict('La paie de ce mois est approuvée : ajustez le mois suivant.');
      if (!(await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } })))
        throw notFound('Employé introuvable.');
      await tx.payrollAdjustment.create({
        data: {
          id,
          companyId: actor.companyId,
          userId: input.userId,
          month,
          amount: BigInt(input.amount),
          reason: input.reason,
          createdByUserId: actor.userId,
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'payroll.adjustment',
        'PayrollAdjustment',
        id,
        undefined,
        {
          userId: input.userId,
          month: input.month,
          amount: input.amount,
          reason: input.reason,
        },
      );
    });
    return (await this.adjustments(input.month)).find((a) => a.id === id)!;
  }

  async dashboard(month: string): Promise<PayrollDashboardDto> {
    const tx = this.db as unknown as Tx;
    const { start, end } = monthRange(month);
    const users = await this.employees(tx, month);
    let baseSalary = 0;
    for (const u of users) baseSalary += Number((await salaryFor(tx, u, month))?.baseSalary ?? 0n);
    const [period, advances, deductions, incentives, pending] = await Promise.all([
      this.db.payrollPeriod.findFirst({ where: { month: start, deletedAt: null } }),
      this.db.salaryAdvance.aggregate({
        where: { month: start, status: { in: ['PAID', 'DEDUCTED'] }, deletedAt: null },
        _sum: { amount: true },
      }),
      this.db.payrollDeduction.aggregate({
        where: {
          status: { in: ['APPROVED', 'APPLIED'] },
          deletedAt: null,
          OR: [{ month: start }, { month: null, status: 'APPROVED' }],
        },
        _sum: { amount: true },
      }),
      this.db.incentive.aggregate({
        where: {
          status: { in: ['VALIDATED', 'APPLIED'] },
          periodEnd: { gte: start, lte: end },
          deletedAt: null,
        },
        _sum: { amount: true },
      }),
      Promise.all([
        this.db.salaryAdvance.count({ where: { status: 'REQUESTED', deletedAt: null } }),
        this.db.payrollDeduction.count({ where: { status: 'PENDING', deletedAt: null } }),
        this.db.incentive.count({ where: { status: 'CALCULATED', deletedAt: null } }),
        this.db.discrepancy.count({
          where: { status: { in: ['VALIDATED', 'UNDER_REVIEW'] }, deletedAt: null },
        }),
      ]),
    ]);
    const net = period
      ? await this.db.payrollEntry.aggregate({
          where: { periodId: period.id },
          _sum: { net: true },
        })
      : null;
    return {
      month,
      employees: users.length,
      payrollStatus: period?.status ?? null,
      baseSalary,
      advancesPaid: Number(advances._sum.amount ?? 0n),
      deductionsApproved: Number(deductions._sum.amount ?? 0n),
      incentivesValidated: Number(incentives._sum.amount ?? 0n),
      net: net ? Number(net._sum.net ?? 0n) : null,
      pending: {
        advances: pending[0],
        deductions: pending[1],
        incentives: pending[2],
        discrepancies: pending[3],
      },
    };
  }

  /** Données de paie de l'employé connecté, et de lui seul. */
  async mine(actor: AuthUser, month: string): Promise<MyPayDto> {
    const { start, end } = monthRange(month);
    const [compensation, incentives, advances, deductions, entry] = await Promise.all([
      this.db.employeeCompensation.findMany({
        where: { userId: actor.userId, deletedAt: null },
        include: { user: WITH_ROLE },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.db.incentive.findMany({
        where: { userId: actor.userId, deletedAt: null, periodEnd: { gte: start, lte: end } },
        include: { rule: true, user: WITH_ROLE },
        orderBy: { periodStart: 'asc' },
      }),
      this.db.salaryAdvance.findMany({
        where: { userId: actor.userId, deletedAt: null, month: start },
        include: { user: WITH_ROLE },
        orderBy: { requestedAt: 'desc' },
      }),
      this.db.payrollDeduction.findMany({
        where: { userId: actor.userId, deletedAt: null, OR: [{ month: start }, { month: null }] },
        include: { user: WITH_ROLE },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.payrollEntry.findFirst({
        where: { userId: actor.userId, deletedAt: null, period: { month: start, deletedAt: null } },
        include: { ...ENTRY, period: true },
      }),
    ]);
    const entryDto = entry ? (await this.entryDtos([entry]))[0]! : null;
    return {
      month,
      compensation: compensation.map(toCompensationDto),
      incentives: await this.incentives.toDtos(incentives),
      advances: await this.advances.toDtos(advances),
      deductions: await this.deductions.toDtos(deductions),
      entry: entry && entryDto ? { ...entryDto, status: entry.period.status } : null,
    };
  }

  private async entryDtos(entries: EntryRow[]): Promise<PayrollEntryDto[]> {
    const name = await namesOf(
      this.db as unknown as Tx,
      entries.flatMap((e) => e.payments.map((p) => p.paidByUserId)),
    );
    return entries.map((e) => ({
      id: e.id,
      user: personOf(e.user),
      baseSalary: Number(e.baseSalary),
      earnings: Number(e.earnings),
      advances: Number(e.advances),
      deductions: Number(e.deductions),
      net: Number(e.net),
      lines: e.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        label: l.label,
        amount: Number(l.amount),
        sourceType: l.sourceType,
        sourceId: l.sourceId,
      })),
      payments: e.payments.map((p) => ({
        id: p.id,
        installment: p.installment,
        dueDate: dateOnly(p.dueDate),
        percent: p.percent,
        amount: Number(p.amount),
        paidAt: p.paidAt?.toISOString() ?? null,
        paidBy: name(p.paidByUserId),
      })),
    }));
  }
}
