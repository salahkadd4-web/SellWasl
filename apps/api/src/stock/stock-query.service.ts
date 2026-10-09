import { Inject, Injectable } from '@nestjs/common';
import { isLowStock, localDate } from '@sellwasl/business-rules';
import type {
  movementsQuerySchema,
  putThresholdsSchema,
  StockAlertDto,
  StockMovementDto,
  StockRowDto,
  Page,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { articleOf, fullName, localRange, warehouseRef } from './stock-helpers';
import { StockLedger } from './stock-ledger.service';
import { paginate, type PageQuery } from '../common/pagination';

const ARTICLES = {
  where: { isActive: true, deletedAt: null, product: { isActive: true, deletedAt: null } },
  include: { product: true },
  orderBy: [{ product: { name: 'asc' } }, { sortOrder: 'asc' }],
} satisfies Prisma.ProductVariantFindManyArgs;

/** Consultation du stock, des mouvements et des alertes ; seuils de stock faible. */
@Injectable()
export class StockQueryService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
  ) {}

  /** Stock d'un entrepôt (le dépôt principal par défaut) pour chaque article actif. */
  async levels(warehouseId?: string): Promise<StockRowDto[]> {
    const warehouse = warehouseId
      ? await this.db.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null } })
      : await this.ledger.mainDepot(this.db as unknown as Prisma.TransactionClient);
    if (!warehouse) throw rule('Entrepôt introuvable.');
    const [variants, stock] = await Promise.all([
      this.db.productVariant.findMany(ARTICLES),
      this.db.stock.findMany({ where: { warehouseId: warehouse.id, deletedAt: null } }),
    ]);
    return variants.map((v) => {
      const s = stock.find((x) => x.productVariantId === v.id);
      const physical = s?.physicalQty ?? 0;
      const reserved = s?.reservedQty ?? 0;
      return {
        variantId: v.id,
        ...articleOf(v),
        physical,
        reserved,
        available: physical - reserved,
        lowStockQty: v.lowStockQty,
        isLow: warehouse.type === 'DEPOT' && isLowStock(physical - reserved, v.lowStockQty),
      };
    });
  }

  /** Les 200 derniers mouvements correspondant aux filtres (BR-STK-03). */
  async movements(q: z.output<typeof movementsQuerySchema>): Promise<Page<StockMovementDto>> {
    let occurredAt: { gte: Date; lt: Date } | undefined;
    if (q.from || q.to) {
      const company = await this.db.company.findFirstOrThrow();
      const today = localDate(new Date(), company.timezone);
      occurredAt = localRange(q.from ?? '2000-01-01', q.to ?? today, company.timezone);
    }
    const where: Prisma.StockMovementWhereInput = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.variantId ? { productVariantId: q.variantId } : {}),
      ...(q.warehouseId
        ? { OR: [{ fromWarehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] }
        : {}),
      ...(occurredAt ? { occurredAt } : {}),
    };
    return paginate(
      q,
      (p) =>
        this.db.stockMovement.findMany({
          where: { AND: [where, p.after] },
          include: {
            productVariant: { include: { product: true } },
            fromWarehouse: true,
            toWarehouse: true,
            user: true,
            reason: true,
          },
          orderBy: p.orderBy,
          take: p.take,
        }),
      () => this.db.stockMovement.count({ where }),
      async (rows) => {
        return rows.map((m) => ({
          id: m.id,
          type: m.type,
          qty: m.qty,
          occurredAt: m.occurredAt.toISOString(),
          variantId: m.productVariantId,
          ...articleOf(m.productVariant),
          from: m.fromWarehouse ? warehouseRef(m.fromWarehouse) : null,
          to: m.toWarehouse ? warehouseRef(m.toWarehouse) : null,
          user: { id: m.user.id, name: fullName(m.user) },
          reason: m.reason?.label ?? null,
          sourceType: m.sourceType,
        }));
      },
    );
  }

  /** Articles dont le disponible est sous le seuil, dans chaque dépôt actif. */
  async alerts(): Promise<StockAlertDto[]> {
    const [variants, depots] = await Promise.all([
      this.db.productVariant.findMany({
        ...ARTICLES,
        where: { ...ARTICLES.where, lowStockQty: { not: null } },
      }),
      this.db.warehouse.findMany({
        where: { type: 'DEPOT', isActive: true, deletedAt: null },
        orderBy: { code: 'asc' },
      }),
    ]);
    if (variants.length === 0 || depots.length === 0) return [];
    const stock = await this.db.stock.findMany({
      where: {
        warehouseId: { in: depots.map((d) => d.id) },
        productVariantId: { in: variants.map((v) => v.id) },
        deletedAt: null,
      },
    });
    return depots.flatMap((d) =>
      variants.flatMap((v) => {
        const s = stock.find((x) => x.warehouseId === d.id && x.productVariantId === v.id);
        const available = (s?.physicalQty ?? 0) - (s?.reservedQty ?? 0);
        return isLowStock(available, v.lowStockQty)
          ? [
              {
                warehouse: warehouseRef(d),
                variantId: v.id,
                ...articleOf(v),
                available,
                lowStockQty: v.lowStockQty!,
              },
            ]
          : [];
      }),
    );
  }

  /** Seuils de stock faible par article, en unité de base ; null retire le seuil. */
  async setThresholds(
    actor: AuthUser,
    input: z.output<typeof putThresholdsSchema>,
  ): Promise<{ updated: number }> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const ids = input.entries.map((e) => e.variantId);
      const found = await tx.productVariant.count({ where: { id: { in: ids }, deletedAt: null } });
      if (found !== ids.length) throw rule('Article introuvable.');
      for (const e of input.entries)
        await tx.productVariant.update({
          where: { id: e.variantId },
          data: { lowStockQty: e.lowStockQty, version: { increment: 1 } },
        });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'stock.thresholds',
          entity: 'ProductVariant',
          after: { entries: input.entries },
        },
        tx,
      );
    });
    return { updated: input.entries.length };
  }
}
