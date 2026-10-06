import { Inject, Injectable } from '@nestjs/common';
import { incentiveAmount, periodOf } from '@sellwasl/business-rules';
import type {
  calculateIncentivesSchema,
  IncentiveDto,
  IncentiveProgressDto,
  IncentiveRuleDto,
  incentiveRuleSchema,
  incentivesQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { conflict, personOf } from '../accounting/discrepancies.service';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { type Actor, audit, namesOf, payrollSettings, type Tx, WITH_ROLE } from './payroll-common';

const RULE_DETAIL = { product: true, user: WITH_ROLE } satisfies Prisma.IncentiveRuleInclude;
type RuleRow = Prisma.IncentiveRuleGetPayload<{ include: typeof RULE_DETAIL }>;
const DETAIL = { rule: true, user: WITH_ROLE } satisfies Prisma.IncentiveInclude;
type Row = Prisma.IncentiveGetPayload<{ include: typeof DETAIL }>;
type RuleInput = z.output<typeof incentiveRuleSchema>;
type RuleRecord = Prisma.IncentiveRuleGetPayload<object>;

/** Vente comptée dans une prime : la ligne, sa commande, sa livraison. */
interface SoldLine {
  orderNumber: string;
  deliveryNumber: string;
  baseQty: number;
  amount: number;
}

/**
 * Primes (phase 21 bis) : règles par unité, pourcentage, seuil, paliers ou objectif de CA ;
 * calcul d'une période à partir des ventes livrées, une seule prime par règle, employé et
 * période ; validation par le comptable avant la paie.
 */
@Injectable()
export class IncentivesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly auditService: AuditService,
  ) {}

  async rules(): Promise<IncentiveRuleDto[]> {
    const rows = await this.db.incentiveRule.findMany({
      where: { deletedAt: null },
      include: RULE_DETAIL,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    const units = await this.db.productUnit.findMany({
      where: { id: { in: rows.flatMap((r) => (r.unitId ? [r.unitId] : [])) } },
    });
    return rows.map((r) => toRuleDto(r, units));
  }

  async createRule(actor: AuthUser, input: RuleInput): Promise<IncentiveRuleDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await this.checkRefs(tx, input);
      await tx.incentiveRule.create({
        data: {
          id,
          companyId: actor.companyId,
          ...this.data(input),
          createdByUserId: actor.userId,
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'incentive_rule.create',
        'IncentiveRule',
        id,
        undefined,
        {
          ...input,
        } as Prisma.InputJsonValue,
      );
    });
    return (await this.rules()).find((r) => r.id === id)!;
  }

  async updateRule(actor: AuthUser, id: string, input: RuleInput): Promise<IncentiveRuleDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const before = await tx.incentiveRule.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw notFound('Règle introuvable.');
      await this.checkRefs(tx, input);
      await tx.incentiveRule.update({
        where: { id },
        data: { ...this.data(input), version: { increment: 1 } },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        'incentive_rule.update',
        'IncentiveRule',
        id,
        {
          name: before.name,
          amount: before.amount === null ? null : Number(before.amount),
          isActive: before.isActive,
        },
        { ...input } as Prisma.InputJsonValue,
      );
    });
    return (await this.rules()).find((r) => r.id === id)!;
  }

  private data(input: RuleInput) {
    return {
      name: input.name,
      kind: input.kind,
      frequency: input.frequency,
      productId: input.productId ?? null,
      unitId: input.unitId ?? null,
      amount: input.amount ? BigInt(input.amount) : null,
      percentBp: input.percentBp ?? null,
      threshold: input.threshold ? BigInt(input.threshold) : null,
      tiers: input.tiers ?? undefined,
      userId: input.userId ?? null,
      roleCode: input.roleCode ?? null,
      isActive: input.isActive,
      validFrom: toDate(input.validFrom),
      validTo: input.validTo ? toDate(input.validTo) : null,
    };
  }

  private async checkRefs(tx: Tx, input: RuleInput) {
    if (
      input.productId &&
      !(await tx.product.findFirst({ where: { id: input.productId, deletedAt: null } }))
    )
      throw rule('Produit inconnu.');
    if (
      input.unitId &&
      !(await tx.productUnit.findFirst({
        where: { id: input.unitId, productId: input.productId ?? undefined },
      }))
    )
      throw rule("Cette unité n'appartient pas au produit.");
    if (
      input.userId &&
      !(await tx.user.findFirst({ where: { id: input.userId, deletedAt: null } }))
    )
      throw rule('Employé inconnu.');
  }

  async list(q: z.output<typeof incentivesQuerySchema>): Promise<IncentiveDto[]> {
    const rows = await this.db.incentive.findMany({
      where: {
        deletedAt: null,
        ...(q.periodStart && { periodStart: toDate(q.periodStart) }),
        ...(q.status && { status: q.status }),
        ...(q.userId && { userId: q.userId }),
      },
      include: DETAIL,
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'asc' }],
      take: 500,
    });
    return this.toDtos(rows);
  }

  /**
   * Calcul d'une période (la semaine ou le mois qui contient la date) : met à jour les primes
   * encore à vérifier, ne touche jamais une prime validée, refusée ou appliquée.
   */
  async calculate(
    actor: Actor,
    input: z.output<typeof calculateIncentivesSchema>,
  ): Promise<IncentiveDto[]> {
    const settings = await payrollSettings(this.db as unknown as Tx);
    const period = periodOf(input.date, input.frequency, settings.weekStartsOn);
    const start = toDate(period.start);
    const end = toDate(period.end);
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      for (const r of await this.activeRules(tx, input.frequency, start, end)) {
        for (const u of await this.targets(tx, r)) {
          const result = await this.compute(tx, r, u, start, end);
          const existing = await tx.incentive.findFirst({
            where: { ruleId: r.id, userId: u.id, periodStart: start },
          });
          if (existing && existing.status !== 'CALCULATED') continue;
          const values = {
            periodEnd: end,
            quantity: result.quantity,
            revenue: BigInt(result.revenue),
            unitAmount: result.unitAmount === null ? null : BigInt(result.unitAmount),
            amount: BigInt(result.amount),
            details: result.details,
          };
          if (existing)
            await tx.incentive.update({
              where: { id: existing.id },
              data: { ...values, version: { increment: 1 } },
            });
          else if (result.amount > 0 || result.quantity > 0)
            await tx.incentive.create({
              data: {
                id: uuidv7(),
                companyId: actor.companyId,
                ruleId: r.id,
                userId: u.id,
                periodStart: start,
                ...values,
                createdByUserId: actor.userId,
              },
            });
        }
      }
      await audit(
        this.auditService,
        tx,
        actor,
        'incentive.calculate',
        'Incentive',
        null,
        undefined,
        {
          frequency: input.frequency,
          periodStart: period.start,
          periodEnd: period.end,
          automatic: actor.userId === null,
        },
      );
    });
    return this.list({ periodStart: period.start });
  }

  /**
   * Progression en direct de l'employé (phase 21 bis) : ses règles actives, la période en cours
   * (semaine ou mois contenant la date), quantité et prime estimée, sans rien enregistrer.
   */
  async progress(actor: AuthUser, date: string): Promise<IncentiveProgressDto[]> {
    const tx = this.db as unknown as Tx;
    const settings = await payrollSettings(tx);
    const user = await tx.user.findFirstOrThrow({
      where: { id: actor.userId },
      include: { role: true },
    });
    const out: IncentiveProgressDto[] = [];
    for (const frequency of ['WEEKLY', 'MONTHLY'] as const) {
      const period = periodOf(date, frequency, settings.weekStartsOn);
      const start = toDate(period.start);
      const end = toDate(period.end);
      const rules = (await this.activeRules(tx, frequency, start, end)).filter(
        (r) => r.userId === user.id || (!r.userId && r.roleCode === user.role.code),
      );
      for (const r of rules) {
        const result = await this.compute(tx, r, user, start, end);
        const saved = await tx.incentive.findFirst({
          where: { ruleId: r.id, userId: user.id, periodStart: start, deletedAt: null },
        });
        const unit = r.unitId ? await tx.productUnit.findFirst({ where: { id: r.unitId } }) : null;
        const base =
          !unit && r.productId
            ? await tx.productUnit.findFirst({ where: { productId: r.productId, isBase: true } })
            : null;
        out.push({
          rule: {
            id: r.id,
            name: r.name,
            kind: r.kind,
            frequency: r.frequency,
            amount: r.amount === null ? null : Number(r.amount),
            threshold: r.threshold === null ? null : Number(r.threshold),
            percentBp: r.percentBp,
            tiers: (r.tiers as IncentiveProgressDto['rule']['tiers']) ?? null,
          },
          periodStart: period.start,
          periodEnd: period.end,
          quantity: result.quantity,
          revenue: result.revenue,
          unitAmount: result.unitAmount,
          estimatedAmount: result.amount,
          unitName: unit?.name ?? base?.name ?? null,
          status: saved?.status ?? null,
        });
      }
    }
    return out;
  }

  private activeRules(tx: Tx, frequency: 'WEEKLY' | 'MONTHLY', start: Date, end: Date) {
    return tx.incentiveRule.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        frequency,
        validFrom: { lte: end },
        OR: [{ validTo: null }, { validTo: { gte: start } }],
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Employés visés par une règle : l'employé désigné, ou tous les actifs du rôle. */
  private targets(tx: Tx, r: { userId: string | null; roleCode: string | null }) {
    return r.userId
      ? tx.user.findMany({ where: { id: r.userId, deletedAt: null }, include: { role: true } })
      : tx.user.findMany({
          where: { deletedAt: null, status: 'ACTIVE', role: { code: r.roleCode as never } },
          include: { role: true },
        });
  }

  /** Prime d'une règle pour un employé et une période, à partir de ses ventes livrées. */
  private async compute(
    tx: Tx,
    r: RuleRecord,
    u: { id: string; role: { code: string } },
    start: Date,
    end: Date,
  ) {
    const unit = r.unitId ? await tx.productUnit.findFirst({ where: { id: r.unitId } }) : null;
    const baseQty = unit?.baseQty ?? 1;
    const sold = await this.sold(tx, u.id, u.role.code, r.productId, start, end);
    const quantity = Math.floor(sold.reduce((s, l) => s + l.baseQty, 0) / baseQty);
    const revenue = sold.reduce((s, l) => s + l.amount, 0);
    const { amount, unitAmount } = incentiveAmount(
      {
        kind: r.kind,
        amount: r.amount === null ? null : Number(r.amount),
        percentBp: r.percentBp,
        threshold: r.threshold === null ? null : Number(r.threshold),
        tiers: (r.tiers as { minQty: number; unitAmount: number }[] | null) ?? null,
      },
      { quantity, revenue },
    );
    const details = sold.map((l) => ({
      orderNumber: l.orderNumber,
      deliveryNumber: l.deliveryNumber,
      qty: Math.floor(l.baseQty / baseQty),
      amount: l.amount,
    }));
    return { quantity, revenue, amount, unitAmount, details };
  }

  /**
   * Ventes valides d'un employé dans la période : lignes payantes livrées (livraison non en
   * échec), au jour de la livraison. Un livreur : les livraisons qu'il a faites ; les autres :
   * les commandes dont ils sont le vendeur.
   */
  private async sold(
    tx: Tx,
    userId: string,
    roleCode: string,
    productId: string | null,
    start: Date,
    end: Date,
  ): Promise<SoldLine[]> {
    const delivered = {
      result: { not: 'FAILED' as const },
      deletedAt: null,
      workday: { date: { gte: start, lte: end } },
    };
    const lines = await tx.orderLine.findMany({
      where: {
        kind: 'NORMAL',
        deliveredQty: { gt: 0 },
        ...(productId && { productId }),
        order:
          roleCode === 'LIVREUR'
            ? { deletedAt: null, deliveries: { some: { ...delivered, userId } } }
            : {
                deletedAt: null,
                sellerUserId: userId,
                status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
                deliveries: { some: delivered },
              },
      },
      include: {
        order: {
          include: { deliveries: { where: { result: { not: 'FAILED' }, deletedAt: null } } },
        },
      },
    });
    return lines.map((l) => ({
      orderNumber: l.order.number,
      deliveryNumber: l.order.deliveries[0]?.number ?? '',
      baseQty: l.deliveredQty ?? 0,
      amount: Number(l.lineAmount),
    }));
  }

  async validate(actor: AuthUser, id: string): Promise<IncentiveDto> {
    return this.decide(actor, id, 'VALIDATED');
  }

  async reject(actor: AuthUser, id: string): Promise<IncentiveDto> {
    return this.decide(actor, id, 'REJECTED');
  }

  private async decide(
    actor: AuthUser,
    id: string,
    status: 'VALIDATED' | 'REJECTED',
  ): Promise<IncentiveDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.$queryRaw`SELECT id FROM incentive WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.incentive.findFirst({ where: { id, deletedAt: null } });
      if (!row) throw notFound('Prime introuvable.');
      if (row.status !== 'CALCULATED') throw conflict('Cette prime est déjà décidée.');
      await tx.incentive.update({
        where: { id },
        data: {
          status,
          validatedByUserId: actor.userId,
          validatedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await audit(
        this.auditService,
        tx,
        actor,
        status === 'VALIDATED' ? 'incentive.validate' : 'incentive.reject',
        'Incentive',
        id,
        { status: row.status },
        { status, amount: Number(row.amount) },
      );
    });
    const row = await this.db.incentive.findFirstOrThrow({ where: { id }, include: DETAIL });
    return (await this.toDtos([row]))[0]!;
  }

  async toDtos(rows: Row[]): Promise<IncentiveDto[]> {
    const name = await namesOf(
      this.db as unknown as Tx,
      rows.map((r) => r.validatedByUserId),
    );
    const units = await this.db.productUnit.findMany({
      where: { id: { in: rows.flatMap((r) => (r.rule.unitId ? [r.rule.unitId] : [])) } },
    });
    const baseUnits = await this.db.productUnit.findMany({
      where: {
        isBase: true,
        productId: { in: rows.flatMap((r) => (r.rule.productId ? [r.rule.productId] : [])) },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      rule: { id: r.rule.id, name: r.rule.name, kind: r.rule.kind },
      user: personOf(r.user),
      periodStart: dateOnly(r.periodStart),
      periodEnd: dateOnly(r.periodEnd),
      quantity: r.quantity,
      revenue: Number(r.revenue),
      unitAmount: r.unitAmount === null ? null : Number(r.unitAmount),
      amount: Number(r.amount),
      unitName:
        units.find((u) => u.id === r.rule.unitId)?.name ??
        baseUnits.find((u) => u.productId === r.rule.productId)?.name ??
        null,
      status: r.status,
      details: r.details as IncentiveDto['details'],
      validatedBy: name(r.validatedByUserId),
      validatedAt: r.validatedAt?.toISOString() ?? null,
    }));
  }
}

function toRuleDto(r: RuleRow, units: { id: string; name: string }[]): IncentiveRuleDto {
  const unit = units.find((u) => u.id === r.unitId);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    frequency: r.frequency,
    product: r.product ? { id: r.product.id, name: r.product.name } : null,
    unit: unit ? { id: unit.id, name: unit.name } : null,
    amount: r.amount === null ? null : Number(r.amount),
    percentBp: r.percentBp,
    threshold: r.threshold === null ? null : Number(r.threshold),
    tiers: (r.tiers as IncentiveRuleDto['tiers']) ?? null,
    user: r.user ? personOf(r.user) : null,
    roleCode: r.roleCode,
    isActive: r.isActive,
    validFrom: dateOnly(r.validFrom),
    validTo: r.validTo ? dateOnly(r.validTo) : null,
  };
}
