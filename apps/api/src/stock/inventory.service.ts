import { Inject, Injectable } from '@nestjs/common';
import { releaseNewestFirst } from '@sellwasl/business-rules';
import type { InventoryDto, InventoryResult, inventoryLinesSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { activeWarehouse, articleOf, toBaseLines, warehouseRef } from './stock-helpers';
import { type Move, StockLedger } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

/** Commandes dont la réservation tient encore au dépôt. */
const RESERVING = ['CONFIRMED', 'LOCKED', 'PREPARING'] as const;

const DETAIL = {
  warehouse: true,
  inventoryCountLines: { include: { productVariant: { include: { product: true } } } },
} as const;

/**
 * Inventaire du dépôt (UC-44, BR-STK-06) : brouillon compté au fur et à mesure, puis validation.
 * Le compté devient le stock réel ; chaque écart produit un `ADJUSTMENT`, audité.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
  ) {}

  async create(actor: AuthUser, warehouseId: string): Promise<InventoryDto> {
    const id = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const depot = await activeWarehouse(tx, warehouseId, 'DEPOT');
      if (
        await tx.inventoryCount.findFirst({
          where: { warehouseId: depot.id, status: 'DRAFT', deletedAt: null },
        })
      )
        throw rule('Un inventaire est déjà en cours pour ce dépôt.');
      await tx.inventoryCount.create({
        data: {
          id,
          companyId: actor.companyId,
          warehouseId: depot.id,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
        },
      });
    });
    return this.get(id);
  }

  /** Remplace le comptage du brouillon ; l'attendu affiché est le physique du moment. */
  async putLines(
    actor: AuthUser,
    id: string,
    input: z.output<typeof inventoryLinesSchema>,
  ): Promise<InventoryDto> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const inventory = await this.draft(tx, id);
      const lines = await toBaseLines(tx, input.lines);
      const stock = await tx.stock.findMany({
        where: {
          warehouseId: inventory.warehouseId,
          productVariantId: { in: lines.map((l) => l.variantId) },
        },
      });
      await tx.inventoryCountLine.deleteMany({ where: { inventoryCountId: id } });
      await tx.inventoryCountLine.createMany({
        data: lines.map((l) => {
          const expected = stock.find((s) => s.productVariantId === l.variantId)?.physicalQty ?? 0;
          return {
            id: uuidv7(),
            companyId: actor.companyId,
            inventoryCountId: id,
            productVariantId: l.variantId,
            expectedQty: expected,
            countedQty: l.qty,
            gapQty: l.qty - expected,
          };
        }),
      });
      await tx.inventoryCount.update({ where: { id }, data: { version: { increment: 1 } } });
    });
    return this.get(id);
  }

  async validate(actor: AuthUser, id: string): Promise<InventoryResult> {
    return this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      const inventory = await this.draft(tx, id);
      const lines = await tx.inventoryCountLine.findMany({ where: { inventoryCountId: id } });
      const warehouseId = inventory.warehouseId;
      const isMain = (await this.ledger.mainDepot(tx)).id === warehouseId;
      const balances = await this.ledger.balances(
        tx,
        actor.companyId,
        warehouseId,
        lines.map((l) => l.productVariantId),
      );
      const releases: Move[] = [];
      const adjustments: Move[] = [];
      const releasedLines: InventoryResult['releasedLines'] = [];
      for (const line of lines) {
        const balance = balances.get(line.productVariantId)!;
        const gap = line.countedQty - balance.physical;
        // Le compté passe sous le réservé : les commandes les plus récentes perdent leur réservation
        if (isMain && line.countedQty < balance.reserved) {
          const reserving = await tx.orderLine.findMany({
            where: {
              productVariantId: line.productVariantId,
              reservedQty: { gt: 0 },
              order: { status: { in: [...RESERVING] }, deletedAt: null },
            },
            include: { order: { include: { customer: true } } },
          });
          const plan = releaseNewestFirst(
            reserving.map((l) => ({ ...l, confirmedAt: l.order.confirmedAt ?? l.order.createdAt })),
            balance.reserved - line.countedQty,
          );
          for (const { line: orderLine, release } of plan) {
            releases.push({
              type: 'RELEASE',
              variantId: line.productVariantId,
              qty: release,
              fromWarehouseId: warehouseId,
              source: { type: 'ORDER', id: orderLine.orderId },
            });
            await tx.orderLine.update({
              where: { id: orderLine.id },
              data: {
                reservedQty: { decrement: release },
                isStockout: true,
                version: { increment: 1 },
              },
            });
            releasedLines.push({
              orderNumber: orderLine.order.number,
              customerName: orderLine.order.customer.name,
              variantId: line.productVariantId,
              released: release,
            });
          }
        }
        if (gap !== 0)
          adjustments.push({
            type: 'ADJUSTMENT',
            variantId: line.productVariantId,
            qty: Math.abs(gap),
            ...(gap < 0 ? { fromWarehouseId: warehouseId } : { toWarehouseId: warehouseId }),
            source: { type: 'INVENTORY', id },
          });
        await tx.inventoryCountLine.update({
          where: { id: line.id },
          data: { expectedQty: balance.physical, gapQty: gap, version: { increment: 1 } },
        });
      }
      const now = new Date();
      // Libérer avant d'ajuster : le réservé ne doit jamais dépasser le physique (BR-STK-04)
      await this.ledger.apply(tx, actor, [...releases, ...adjustments], now);
      await tx.inventoryCount.update({
        where: { id },
        data: { status: 'VALIDATED', validatedAt: now, occurredAt: now, version: { increment: 1 } },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'inventory.validate',
          entity: 'InventoryCount',
          entityId: id,
          after: {
            adjustments: adjustments.map((m) => [m.variantId, m.fromWarehouseId ? -m.qty : m.qty]),
            releasedLines,
          },
        },
        tx,
      );
      return { adjustments: adjustments.length, releasedLines };
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await this.draft(tx, id);
      await tx.inventoryCount.delete({ where: { id } });
    });
  }

  async list(): Promise<InventoryDto[]> {
    const rows = await this.db.inventoryCount.findMany({
      where: { deletedAt: null },
      include: DETAIL,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toDto);
  }

  async get(id: string): Promise<InventoryDto> {
    const row = await this.db.inventoryCount.findFirst({
      where: { id, deletedAt: null },
      include: DETAIL,
    });
    if (!row) throw notFound('Inventaire introuvable.');
    return toDto(row);
  }

  private async draft(tx: Tx, id: string) {
    const inventory = await tx.inventoryCount.findFirst({ where: { id, deletedAt: null } });
    if (!inventory) throw notFound('Inventaire introuvable.');
    if (inventory.status !== 'DRAFT') throw rule('Cet inventaire est déjà validé.');
    // Verrou : deux validations simultanées du même brouillon ne s'appliquent pas deux fois
    await tx.$queryRaw`SELECT id FROM inventory_count WHERE id = ${id}::uuid FOR UPDATE`;
    const fresh = await tx.inventoryCount.findFirstOrThrow({ where: { id } });
    if (fresh.status !== 'DRAFT') throw rule('Cet inventaire est déjà validé.');
    return fresh;
  }
}

function toDto(row: Prisma.InventoryCountGetPayload<{ include: typeof DETAIL }>): InventoryDto {
  return {
    id: row.id,
    warehouse: warehouseRef(row.warehouse),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    validatedAt: row.validatedAt?.toISOString() ?? null,
    lines: row.inventoryCountLines
      .map((l) => ({
        variantId: l.productVariantId,
        ...articleOf(l.productVariant),
        expectedQty: l.expectedQty,
        countedQty: l.countedQty,
        gapQty: l.gapQty,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName)),
  };
}
