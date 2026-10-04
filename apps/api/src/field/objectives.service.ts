import { Inject, Injectable } from '@nestjs/common';
import { localDate, objectiveProgress } from '@sellwasl/business-rules';
import type { MyObjective } from '@sellwasl/validation';
import type { AuthUser } from '../common/auth-context';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { toDate } from './field-errors';

/** Premier jour du mois suivant, au format AAAA-MM-JJ. */
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Objectifs du vendeur connecté (UC-20, BR-OBJ-01 à BR-OBJ-04). */
@Injectable()
export class ObjectivesService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  async mine(actor: AuthUser, requestedMonth?: string): Promise<MyObjective[]> {
    const company = await this.db.company.findFirstOrThrow();
    const month = requestedMonth ?? localDate(new Date(), company.timezone).slice(0, 7);
    return (await this.forMonth(month, actor.userId)).map(({ id: _id, userId: _u, ...o }) => o);
  }

  /** Objectifs d'un mois, d'un vendeur ou de tous, avec le réalisé et la prime (BR-OBJ-02, 03). */
  async forMonth(
    month: string,
    userId?: string,
  ): Promise<(MyObjective & { id: string; userId: string })[]> {
    const from = toDate(`${month}-01`);
    const to = toDate(nextMonth(month));
    const objectives = await this.db.objective.findMany({
      where: { month: from, deletedAt: null, ...(userId ? { userId } : {}) },
      include: { range: true },
      orderBy: { range: { name: 'asc' } },
    });
    if (objectives.length === 0) return [];

    // Réalisé : lignes payantes livrées dans le mois, commandes du vendeur (BR-OBJ-02)
    const lines = await this.db.orderLine.findMany({
      where: {
        kind: { not: 'BONUS' },
        deliveredQty: { gt: 0 },
        product: { rangeId: { in: objectives.map((o) => o.rangeId) } },
        order: {
          sellerUserId: { in: [...new Set(objectives.map((o) => o.userId))] },
          status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
          deliveryDate: { gte: from, lt: to },
          deletedAt: null,
        },
      },
      select: {
        deliveredQty: true,
        unitPrice: true,
        product: { select: { rangeId: true } },
        order: { select: { sellerUserId: true } },
      },
    });
    // Réalisé par vendeur et par gamme
    const key = (userId: string, rangeId: string) => `${userId}:${rangeId}`;
    const realized = new Map<string, number>();
    for (const l of lines) {
      const k = key(l.order.sellerUserId, l.product.rangeId);
      realized.set(k, (realized.get(k) ?? 0) + (l.deliveredQty ?? 0) * Number(l.unitPrice));
    }

    return objectives.map((o) => {
      const amounts = {
        targetAmount: Number(o.targetAmount),
        realizedAmount: realized.get(key(o.userId, o.rangeId)) ?? 0,
        bonusAmount: Number(o.bonusAmount),
        capPercent: o.capPercent,
      };
      return {
        id: o.id,
        userId: o.userId,
        range: { id: o.range.id, code: o.range.code, name: o.range.name },
        month,
        ...amounts,
        ...objectiveProgress(amounts),
      };
    });
  }
}
