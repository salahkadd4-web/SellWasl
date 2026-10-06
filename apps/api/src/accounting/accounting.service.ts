import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { settlementGap } from '@sellwasl/business-rules';
import type {
  DaySummaryDto,
  DebtorDto,
  PaymentRowDto,
  SettlementDetailDto,
  SettlementRowDto,
} from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { cell } from '../common/csv';
import { uuidv7 } from '../common/uuid';
import { ReceiptsService } from '../delivery/receipts.service';
import { DISCREPANCY_DETAIL, DiscrepanciesService, personOf } from './discrepancies.service';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { fullName } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

/**
 * Comptabilité (UC-70, UC-71, BR-PAY-07, BR-PAY-08) : récapitulatif des journées, versements au
 * comptable avec leur écart, dettes des clients, paiements et export CSV.
 */
@Injectable()
export class AccountingService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly receipts: ReceiptsService,
    private readonly audit: AuditService,
    private readonly discrepancies: DiscrepanciesService,
  ) {}

  /**
   * Détail d'un versement (phase 21 bis) : attendu, remis, écart et justification, ventes,
   * paiements, impayés, retours, écarts de marchandise de la journée et écart de caisse.
   */
  async detail(workdayId: string): Promise<SettlementDetailDto> {
    const workday = await this.db.workday.findFirst({
      where: { id: workdayId, deletedAt: null },
      include: { user: { include: { role: true } }, settlement: true },
    });
    if (!workday) throw notFound('Journée introuvable.');
    const date = dateOnly(workday.date);
    const [summary, discrepancies, returned] = await Promise.all([
      this.receipts.summary(workday.id, workday.userId, date),
      this.db.discrepancy.findMany({
        where: { workdayId, deletedAt: null },
        include: DISCREPANCY_DETAIL,
        orderBy: { createdAt: 'asc' },
      }),
      this.db.returnFact.aggregate({
        where: {
          kind: 'RETURN',
          unloadId: { not: null },
          driverUserId: workday.userId,
          date: workday.date,
        },
        _sum: { value: true },
      }),
    ]);
    const dtos = await this.discrepancies.toDtos(discrepancies);
    const s = workday.settlement;
    return {
      workdayId,
      date,
      user: personOf(workday.user),
      expected: s ? Number(s.expectedAmount) : summary.expected,
      remitted: s ? Number(s.remittedAmount) : null,
      gap: s ? Number(s.gapAmount) : null,
      note: s?.note ?? null,
      sales: summary.totalSold,
      cashSales: summary.cashSales,
      cashDebts: summary.cashDebts,
      credit: summary.credit,
      receipts: summary.receipts,
      returnedValue: Number(returned._sum.value ?? 0n),
      stockDiscrepancies: dtos.filter((d) => d.kind === 'STOCK'),
      financialDiscrepancy: dtos.find((d) => d.kind === 'FINANCIAL') ?? null,
    };
  }

  async workdaySummary(workdayId: string): Promise<DaySummaryDto> {
    const workday = await this.db.workday.findFirst({ where: { id: workdayId, deletedAt: null } });
    if (!workday) throw notFound('Journée introuvable.');
    return this.receipts.summary(workday.id, workday.userId, dateOnly(workday.date));
  }

  /** Journées d'une date où de l'argent a été encaissé, avec leur versement éventuel. */
  async settlements(date: string): Promise<SettlementRowDto[]> {
    const workdays = await this.db.workday.findMany({
      where: { date: toDate(date), deletedAt: null, payments: { some: { deletedAt: null } } },
      include: { user: { include: { role: true } }, settlement: true },
      orderBy: { createdAt: 'asc' },
    });
    const rows: SettlementRowDto[] = [];
    for (const w of workdays) {
      const summary = await this.receipts.summary(w.id, w.userId, date);
      rows.push(toRow(w, summary.expected));
    }
    return rows;
  }

  /** Versement d'une journée clôturée (BR-PAY-08) : un seul, écart = remis − attendu, audité. */
  async settle(
    actor: AuthUser,
    workdayId: string,
    remitted: number,
    note?: string,
  ): Promise<SettlementRowDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.$queryRaw`SELECT id FROM workday WHERE id = ${workdayId}::uuid FOR UPDATE`;
      const workday = await tx.workday.findFirst({
        where: { id: workdayId, deletedAt: null },
        include: { settlement: true },
      });
      if (!workday) throw notFound('Journée introuvable.');
      if (workday.status !== 'CLOSED')
        throw rule('La journée est encore en cours : le versement se fait après la clôture.');
      if (workday.settlement)
        throw new ApiError(
          HttpStatus.CONFLICT,
          'DUPLICATE',
          'Le versement de cette journée est déjà enregistré.',
        );
      const { expected } = await this.receipts.summary(
        workday.id,
        workday.userId,
        dateOnly(workday.date),
      );
      const gap = settlementGap(expected, remitted);
      const now = new Date();
      const settlementId = uuidv7();
      await tx.settlement.create({
        data: {
          id: settlementId,
          companyId: actor.companyId,
          workdayId: workday.id,
          expectedAmount: BigInt(expected),
          remittedAmount: BigInt(remitted),
          gapAmount: BigInt(gap),
          validatedAt: now,
          accountantUserId: actor.userId,
          note: note || null,
        },
      });
      // Écart de caisse : enregistré pour analyse, relié à la journée (phase 21 bis)
      if (gap !== 0)
        await tx.discrepancy.create({
          data: {
            id: uuidv7(),
            companyId: actor.companyId,
            kind: 'FINANCIAL',
            status: 'VALIDATED',
            date: workday.date,
            userId: workday.userId,
            workdayId: workday.id,
            settlementId,
            amount: BigInt(gap),
            cause: note || null,
            validatedByUserId: actor.userId,
            validatedAt: now,
            createdByUserId: actor.userId,
          },
        });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'settlement.create',
          entity: 'Workday',
          entityId: workday.id,
          after: { expected, remitted, gap, note: note || null },
        },
        tx,
      );
    });
    const workday = await this.db.workday.findFirstOrThrow({
      where: { id: workdayId },
      include: { user: { include: { role: true } }, settlement: true },
    });
    return toRow(workday, Number(workday.settlement!.expectedAmount));
  }

  /** Clients qui doivent de l'argent, du plus endetté au moins endetté. */
  async debtors(): Promise<DebtorDto[]> {
    const customers = await this.db.customer.findMany({
      where: { deletedAt: null, debtAmount: { gt: 0 } },
      orderBy: { debtAmount: 'desc' },
      take: 500,
    });
    return customers.map((c) => ({
      customer: { id: c.id, code: c.code, name: c.name },
      debtAmount: Number(c.debtAmount),
      creditLimitAmount: Number(c.creditLimitAmount),
      isCreditAllowed: c.isCreditAllowed,
    }));
  }

  async payments(from: string, to: string): Promise<PaymentRowDto[]> {
    // La période porte sur le jour de travail où l'argent a été encaissé
    const rows = await this.db.payment.findMany({
      where: { deletedAt: null, workday: { date: { gte: toDate(from), lte: toDate(to) } } },
      include: { customer: true, user: true },
      orderBy: { occurredAt: 'asc' },
      take: 5000,
    });
    return rows.map((p) => ({
      id: p.id,
      number: p.number,
      kind: p.kind,
      at: (p.occurredAt ?? p.createdAt).toISOString(),
      customer: p.customer.name,
      user: fullName(p.user),
      dueAmount: Number(p.dueAmount),
      cashAmount: Number(p.cashAmount),
      creditAmount: Number(p.creditAmount),
    }));
  }

  /** Paiements d'une période en CSV (séparateur « ; », lisible par Excel en français). */
  async paymentsCsv(from: string, to: string): Promise<string> {
    const rows = await this.payments(from, to);
    const header = ['Numéro', 'Type', 'Date', 'Client', 'Encaissé par', 'Dû', 'Espèces', 'Crédit'];
    const lines = rows.map((r) =>
      [
        r.number,
        r.kind === 'DEBT_PAYMENT' ? 'Dette' : 'Livraison ou vente',
        r.at,
        r.customer,
        r.user,
        r.dueAmount,
        r.cashAmount,
        r.creditAmount,
      ]
        .map(cell)
        .join(';'),
    );
    return `${[header.join(';'), ...lines].join('\n')}\n`;
  }
}

function toRow(
  w: Prisma.WorkdayGetPayload<{ include: { user: { include: { role: true } }; settlement: true } }>,
  expected: number,
): SettlementRowDto {
  return {
    workdayId: w.id,
    date: dateOnly(w.date),
    user: { id: w.user.id, code: w.user.code, name: fullName(w.user), role: w.user.role.name },
    workdayStatus: w.status,
    expected,
    remitted: w.settlement ? Number(w.settlement.remittedAmount) : null,
    gap: w.settlement ? Number(w.settlement.gapAmount) : null,
    validatedAt: w.settlement?.validatedAt.toISOString() ?? null,
  };
}
