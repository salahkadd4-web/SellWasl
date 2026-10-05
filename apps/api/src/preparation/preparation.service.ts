import { Inject, Injectable } from '@nestjs/common';
import { defaultPrepared } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type PrepareResult,
  type prepareRouteSchema,
  type RoutePreparationDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, invalidState, rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleName, articleOf } from '../stock/stock-helpers';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { OrderRepricer } from './order-repricer.service';
import { summary } from './routes.service';

type Tx = Prisma.TransactionClient;

const ORDERS = {
  where: { deletedAt: null },
  orderBy: { number: 'asc' },
  include: {
    customer: true,
    orderLines: {
      where: { kind: { in: ['NORMAL', 'BONUS'] } },
      include: { productVariant: { include: { product: true } }, unit: true },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    },
  },
} satisfies Prisma.DeliveryRoute$ordersArgs;

/**
 * Préparation d'une tournée (BR-PRE-03, BR-PRE-04, UC-41) : quantités préparées dans l'unité de
 * chaque ligne ; une rupture réduit la ligne, paliers et bonus sont recalculés selon P-04, la
 * réservation suit le préparé. Commandes et tournée passent `READY`.
 */
@Injectable()
export class PreparationService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly repricer: OrderRepricer,
    private readonly audit: AuditService,
  ) {}

  /** Liste de chargement (total par article) et détail par commande. */
  async view(routeId: string): Promise<RoutePreparationDto> {
    const route = await this.db.deliveryRoute.findFirst({
      where: { id: routeId, deletedAt: null },
      include: { deliveryUser: true, truck: true, orders: ORDERS },
    });
    if (!route) throw notFound('Tournée introuvable.');
    const depot = await this.ledger.mainDepot(this.db as unknown as Tx);
    const lines = route.orders.flatMap((o) => o.orderLines);
    const stock = await this.db.stock.findMany({
      where: {
        warehouseId: depot.id,
        productVariantId: { in: [...new Set(lines.map((l) => l.productVariantId))] },
      },
    });
    const items = new Map<string, RoutePreparationDto['items'][number]>();
    for (const l of lines) {
      const s = stock.find((x) => x.productVariantId === l.productVariantId);
      const item = items.get(l.productVariantId) ?? {
        variantId: l.productVariantId,
        ...articleOf(l.productVariant),
        orderedBase: 0,
        reservedBase: 0,
        available: (s?.physicalQty ?? 0) - (s?.reservedQty ?? 0),
      };
      item.orderedBase += l.orderedQty;
      item.reservedBase += l.reservedQty;
      items.set(l.productVariantId, item);
    }
    return {
      route: summary(route, route.orders.length),
      items: [...items.values()].sort((a, b) => a.productName.localeCompare(b.productName)),
      orders: route.orders.map((o) => ({
        orderId: o.id,
        number: o.number,
        customerName: o.customer.name,
        lines: o.orderLines.map((l) => ({
          lineId: l.id,
          kind: l.kind as 'NORMAL' | 'BONUS',
          variantId: l.productVariantId,
          ...articleOf(l.productVariant),
          unitName: l.unit.name,
          unitBaseQty: l.unit.baseQty,
          enteredQty: l.enteredQty,
          reservedQty: l.reservedQty,
          preparedQty: l.preparedQty === null ? null : l.preparedQty / l.unit.baseQty,
          defaultPrepared: Math.min(l.enteredQty, defaultPrepared(l.reservedQty, l.unit.baseQty)),
        })),
      })),
    };
  }

  async prepare(
    actor: AuthUser,
    routeId: string,
    input: z.output<typeof prepareRouteSchema>,
  ): Promise<PrepareResult> {
    return this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      // Verrou de la tournée : deux préparations simultanées ne s'appliquent pas deux fois
      await tx.$queryRaw`SELECT id FROM delivery_route WHERE id = ${routeId}::uuid FOR UPDATE`;
      const route = await tx.deliveryRoute.findFirst({
        where: { id: routeId, deletedAt: null },
        include: { orders: ORDERS },
      });
      if (!route) throw notFound('Tournée introuvable.');
      if (route.status !== 'PREPARING')
        throw invalidState('Cette tournée n’est pas à préparer : elle est déjà préparée.');

      const prepared = new Map(input.lines.map((l) => [l.lineId, l.preparedQty]));
      const lines = route.orders.flatMap((o) => o.orderLines);
      if (lines.some((l) => !prepared.has(l.id)))
        throw rule('Indiquez la quantité préparée de chaque ligne.');
      if (input.lines.some((l) => !lines.some((x) => x.id === l.lineId)))
        throw rule('Une ligne ne fait pas partie de cette tournée.');
      for (const l of lines)
        if (prepared.get(l.id)! > l.enteredQty)
          throw rule(`Préparé au-delà du commandé : ${articleName(l.productVariant)}.`);

      const settingsRow = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
      const recalculate = companySettingsSchema.parse(settingsRow?.data ?? {}).rules
        .P04_recalculateOnDecrease;
      const depot = await this.ledger.mainDepot(tx);
      const moves: Move[] = [];
      const result: PrepareResult['orders'] = [];

      for (const order of route.orders) {
        const normals = order.orderLines.filter((l) => l.kind === 'NORMAL');
        const bonuses = order.orderLines.filter((l) => l.kind === 'BONUS');
        // Paliers et bonus recalculés sur les quantités préparées (BR-CAT-10, P-04), seulement
        // quand une quantité baisse : sinon la commande garde ses prix confirmés
        const decreased = normals.some((l) => prepared.get(l.id)! < l.enteredQty);
        const { prices: priceOf, bonus: bonusOf } = await this.repricer.reprice(
          order,
          normals.map((l) => ({
            id: l.id,
            variantId: l.productVariantId,
            unitId: l.unitId,
            unitPrice: l.unitPrice,
            qty: prepared.get(l.id)!,
          })),
          bonuses.map((b) => ({
            id: b.id,
            bonusRuleId: b.bonusRuleId,
            variantId: b.productVariantId,
            maxQty: prepared.get(b.id)!,
          })),
          [],
          recalculate && decreased,
        );

        let total = 0n;
        for (const l of order.orderLines) {
          const qty = l.kind === 'BONUS' ? bonusOf.get(l.id)! : prepared.get(l.id)!;
          const base = qty * l.unit.baseQty;
          const diff = base - l.reservedQty;
          if (diff !== 0)
            moves.push({
              type: diff > 0 ? 'RESERVATION' : 'RELEASE',
              variantId: l.productVariantId,
              qty: Math.abs(diff),
              ...(diff > 0 ? { toWarehouseId: depot.id } : { fromWarehouseId: depot.id }),
              source: { type: 'ORDER', id: order.id },
            });
          const unitPrice = l.kind === 'BONUS' ? 0n : priceOf.get(l.id)!;
          const lineAmount = unitPrice * BigInt(qty);
          if (l.kind === 'NORMAL') total += lineAmount;
          await tx.orderLine.update({
            where: { id: l.id },
            data: {
              preparedQty: base,
              reservedQty: base,
              unitPrice,
              lineAmount,
              isStockout: base < l.orderedQty,
              version: { increment: 1 },
            },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'READY', totalAmount: total, version: { increment: 1 } },
        });
        result.push({ orderId: order.id, number: order.number, totalAmount: Number(total) });
      }

      // Une réservation complétée est refusée si le dépôt n'a plus le disponible (BR-STK-04)
      await this.ledger.apply(tx, actor, moves);
      await tx.deliveryRoute.update({
        where: { id: routeId },
        data: { status: 'READY', version: { increment: 1 } },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'route.prepare',
          entity: 'DeliveryRoute',
          entityId: routeId,
          after: { orders: result },
        },
        tx,
      );
      return { orders: result };
    });
  }
}
