import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  DiscrepancyDto,
  discrepanciesQuerySchema,
  discrepancyDecisionSchema,
  PersonDto,
  Page,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, frDate, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleName, fullName } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { paginate, type PageQuery } from '../common/pagination';

type Tx = Prisma.TransactionClient;

export const DISCREPANCY_DETAIL = {
  user: { include: { role: true } },
  deduction: true,
} satisfies Prisma.DiscrepancyInclude;
type Row = Prisma.DiscrepancyGetPayload<{ include: typeof DISCREPANCY_DETAIL }>;

export const conflict = (message: string) => new ApiError(HttpStatus.CONFLICT, 'CONFLICT', message);

export const personOf = (u: {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  role: { name: string };
}): PersonDto => ({ id: u.id, code: u.code, name: fullName(u), role: u.role.name });

/**
 * Écarts de stock et de caisse (phase 21 bis) : constatés et validés au déchargement ou au
 * versement, analysés par le comptable, qui décide de la responsabilité. Une responsabilité
 * confirmée crée une retenue en attente d'approbation, jamais appliquée d'office.
 */
@Injectable()
export class DiscrepanciesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(q: z.output<typeof discrepanciesQuerySchema>): Promise<Page<DiscrepancyDto>> {
    const where: Prisma.DiscrepancyWhereInput = {
      deletedAt: null,
      ...(q.status === 'OPEN'
        ? { status: { in: ['VALIDATED' as const, 'UNDER_REVIEW' as const] } }
        : q.status && { status: q.status }),
      ...(q.kind && { kind: q.kind }),
      ...(q.userId && { userId: q.userId }),
      ...((q.from || q.to) && {
        date: { ...(q.from && { gte: toDate(q.from) }), ...(q.to && { lte: toDate(q.to) }) },
      }),
    };
    return paginate(
      q,
      (p) =>
        this.db.discrepancy.findMany({
          where: { AND: [where, p.after] },
          include: DISCREPANCY_DETAIL,
          orderBy: p.orderBy,
          take: p.take,
        }),
      () => this.db.discrepancy.count({ where }),
      async (rows) => {
        return this.toDtos(rows);
      },
    );
  }

  async get(id: string): Promise<DiscrepancyDto> {
    const row = await this.db.discrepancy.findFirst({
      where: { id, deletedAt: null },
      include: DISCREPANCY_DETAIL,
    });
    if (!row) throw notFound('Écart introuvable.');
    return (await this.toDtos([row]))[0]!;
  }

  /** Le comptable prend l'écart en analyse. */
  async review(actor: AuthUser, id: string): Promise<DiscrepancyDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await this.lock(tx, id);
      if (row.status !== 'VALIDATED') throw conflict('Cet écart est déjà en analyse ou décidé.');
      await tx.discrepancy.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', version: { increment: 1 } },
      });
      await this.write(
        tx,
        actor,
        'discrepancy.review',
        id,
        { status: row.status },
        { status: 'UNDER_REVIEW' },
      );
    });
    return this.get(id);
  }

  /**
   * Décision du comptable : pas de responsabilité (résolu), écart non fondé (rejeté), ou
   * responsabilité confirmée : retenue en attente, d'au plus le manque.
   */
  async decide(
    actor: AuthUser,
    id: string,
    input: z.output<typeof discrepancyDecisionSchema>,
  ): Promise<DiscrepancyDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const row = await this.lock(tx, id);
      if (row.status !== 'VALIDATED' && row.status !== 'UNDER_REVIEW')
        throw conflict('Cet écart est déjà décidé.');
      const now = new Date();
      let status: 'RESOLVED' | 'REJECTED' | 'DEDUCTION_PENDING' = 'RESOLVED';
      let deduction: { id: string; amount: number } | null = null;
      if (input.decision === 'REJECT') status = 'REJECTED';
      if (input.decision === 'LIABILITY') {
        const missing = -Number(row.amount);
        if (missing <= 0) throw rule('Seul un manque peut donner une retenue.');
        const amount = input.amount ?? missing;
        if (amount > missing)
          throw rule(`La retenue ne peut pas dépasser le manque (${missing} DA).`);
        deduction = { id: uuidv7(), amount };
        await tx.payrollDeduction.create({
          data: {
            id: deduction.id,
            companyId: actor.companyId,
            userId: row.userId,
            amount: BigInt(amount),
            reason: `${row.kind === 'STOCK' ? 'Écart de stock' : 'Écart de caisse'} du ${frDate(
              dateOnly(row.date),
            )} : ${input.note}`,
            sourceType: row.kind === 'STOCK' ? 'STOCK_DISCREPANCY' : 'FINANCIAL_DISCREPANCY',
            discrepancyId: row.id,
            createdByUserId: actor.userId,
          },
        });
        status = 'DEDUCTION_PENDING';
      }
      await tx.discrepancy.update({
        where: { id },
        data: {
          status,
          decisionNote: input.note,
          decidedByUserId: actor.userId,
          decidedAt: now,
          version: { increment: 1 },
        },
      });
      await this.write(
        tx,
        actor,
        'discrepancy.decide',
        id,
        { status: row.status },
        { status, decision: input.decision, note: input.note, deduction },
      );
    });
    return this.get(id);
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM discrepancy WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.discrepancy.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('Écart introuvable.');
    return row;
  }

  private write(
    tx: Tx,
    actor: AuthUser,
    action: string,
    entityId: string,
    before: Prisma.InputJsonValue,
    after: Prisma.InputJsonValue,
  ) {
    return this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action,
        entity: 'Discrepancy',
        entityId,
        before,
        after,
      },
      tx,
    );
  }

  async toDtos(rows: Row[]): Promise<DiscrepancyDto[]> {
    const [variants, users] = await Promise.all([
      this.db.productVariant.findMany({
        where: {
          id: { in: rows.flatMap((r) => (r.productVariantId ? [r.productVariantId] : [])) },
        },
        include: { product: true },
      }),
      this.db.user.findMany({
        where: {
          id: {
            in: rows.flatMap((r) => [
              r.validatedByUserId,
              ...(r.decidedByUserId ? [r.decidedByUserId] : []),
            ]),
          },
        },
      }),
    ]);
    const name = (id: string | null) => {
      const u = users.find((x) => x.id === id);
      return u ? fullName(u) : null;
    };
    return rows.map((r) => {
      const variant = variants.find((v) => v.id === r.productVariantId);
      return {
        id: r.id,
        kind: r.kind,
        status: r.status,
        date: dateOnly(r.date),
        user: personOf(r.user),
        workdayId: r.workdayId,
        article: variant ? articleName(variant) : null,
        qty: r.qty,
        unitValue: r.unitValue === null ? null : Number(r.unitValue),
        amount: Number(r.amount),
        cause: r.cause,
        validatedBy: name(r.validatedByUserId) ?? '—',
        validatedAt: r.validatedAt.toISOString(),
        decisionNote: r.decisionNote,
        decidedBy: name(r.decidedByUserId),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        deduction: r.deduction
          ? { id: r.deduction.id, amount: Number(r.deduction.amount), status: r.deduction.status }
          : null,
      };
    });
  }
}
