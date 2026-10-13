import { Inject, Injectable } from '@nestjs/common';
import type { DailyObjectiveDto, DailyObjectiveInput } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'] as const;
const DETAIL = { product: true, user: true } satisfies Prisma.IncentiveRuleInclude;
type Row = Prisma.IncentiveRuleGetPayload<{ include: typeof DETAIL }>;

/**
 * Objectifs du jour (BR-OBJ-06, BR-OBJ-07), fixés par le superviseur : une quantité d'un produit
 * par jour pour un vendeur. Portés par une règle de prime hebdomadaire (DAILY_TARGET) : calcul de
 * nuit, validation par le comptable et paie comme les autres primes.
 */
@Injectable()
export class DailyObjectivesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DailyObjectiveDto[]> {
    const rows = await this.db.incentiveRule.findMany({
      where: { deletedAt: null, kind: 'DAILY_TARGET' },
      include: DETAIL,
      orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }],
    });
    const units = await this.db.productUnit.findMany({
      where: { id: { in: rows.flatMap((r) => (r.unitId ? [r.unitId] : [])) } },
    });
    return rows.map((r) => toDto(r, units));
  }

  async create(actor: AuthUser, input: DailyObjectiveInput): Promise<DailyObjectiveDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const data = await this.data(tx, input);
      await tx.incentiveRule.create({
        data: { id, companyId: actor.companyId, ...data, createdByUserId: actor.userId },
      });
      await this.log(tx, actor, 'objective.daily.create', id, input);
    });
    return (await this.list()).find((o) => o.id === id)!;
  }

  async update(
    actor: AuthUser,
    id: string,
    input: DailyObjectiveInput,
  ): Promise<DailyObjectiveDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const before = await tx.incentiveRule.findFirst({
        where: { id, deletedAt: null, kind: 'DAILY_TARGET' },
      });
      if (!before) throw notFound('Objectif du jour introuvable.');
      await tx.incentiveRule.update({
        where: { id },
        data: { ...(await this.data(tx, input)), version: { increment: 1 } },
      });
      await this.log(tx, actor, 'objective.daily.update', id, input);
    });
    return (await this.list()).find((o) => o.id === id)!;
  }

  /** Règle de prime de l'objectif ; vendeur, produit et unité vérifiés. */
  private async data(tx: Prisma.TransactionClient, input: DailyObjectiveInput) {
    const [seller, product, unit] = await Promise.all([
      tx.user.findFirst({
        where: { id: input.userId, deletedAt: null, role: { code: { in: [...SELLER_ROLES] } } },
      }),
      tx.product.findFirst({ where: { id: input.productId, deletedAt: null } }),
      tx.productUnit.findFirst({ where: { id: input.unitId, productId: input.productId } }),
    ]);
    if (!seller)
      throw rule('Les objectifs du jour concernent les pré-vendeurs et les vendeurs cash van.');
    if (!product) throw rule('Produit introuvable.');
    if (!unit) throw rule("Cette unité n'appartient pas au produit.");
    return {
      name: `Objectif du jour · ${product.name}`,
      kind: 'DAILY_TARGET' as const,
      frequency: 'WEEKLY' as const,
      amount: BigInt(input.bonusAmount),
      dailyTarget: input.dailyTarget,
      capPercent: input.capPercent,
      minQty: input.minQty ?? null,
      productId: input.productId,
      unitId: input.unitId,
      userId: input.userId,
      roleCode: null,
      isActive: input.isActive,
      validFrom: toDate(input.validFrom),
      validTo: input.validTo ? toDate(input.validTo) : null,
    };
  }

  private log(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    action: 'objective.daily.create' | 'objective.daily.update',
    id: string,
    input: DailyObjectiveInput,
  ) {
    return this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action,
        entity: 'IncentiveRule',
        entityId: id,
        after: input as unknown as Prisma.InputJsonValue,
      },
      tx,
    );
  }
}

function toDto(r: Row, units: { id: string; name: string }[]): DailyObjectiveDto {
  const unit = units.find((u) => u.id === r.unitId);
  return {
    id: r.id,
    version: r.version,
    user: r.user
      ? { id: r.user.id, code: r.user.code, name: `${r.user.firstName} ${r.user.lastName}` }
      : { id: '', code: '', name: '' },
    product: r.product ? { id: r.product.id, name: r.product.name } : { id: '', name: '' },
    unit: unit ? { id: unit.id, name: unit.name } : { id: '', name: '' },
    dailyTarget: r.dailyTarget ?? 0,
    bonusAmount: Number(r.amount ?? 0),
    capPercent: r.capPercent,
    minQty: r.minQty,
    validFrom: dateOnly(r.validFrom),
    validTo: r.validTo ? dateOnly(r.validTo) : null,
    isActive: r.isActive,
  };
}
