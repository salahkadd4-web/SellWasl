import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import type {
  DriverDeliveryDto,
  DriverRouteDto,
  RouteProgress,
  TruckStockDto,
} from '@sellwasl/validation';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleOf } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

/** Avancement d'une tournée : résultat de la dernière livraison de chaque commande. */
export async function routeProgress(tx: Pick<Tx, 'order' | 'payment'>, routeId: string) {
  const orders = await tx.order.findMany({
    where: {
      deletedAt: null,
      OR: [{ routeId }, { deliveries: { some: { routeId } } }],
    },
    include: { deliveries: { where: { routeId }, orderBy: { attempt: 'desc' }, take: 1 } },
  });
  const progress: RouteProgress = { delivered: 0, partial: 0, failed: 0, pending: 0, collected: 0 };
  for (const o of orders) {
    const result = o.deliveries[0]?.result;
    if (result === 'DELIVERED') progress.delivered += 1;
    else if (result === 'PARTIAL') progress.partial += 1;
    else if (result === 'FAILED') progress.failed += 1;
    else progress.pending += 1;
  }
  const cash = await tx.payment.aggregate({
    where: { kind: 'DELIVERY_PAYMENT', delivery: { routeId }, deletedAt: null },
    _sum: { cashAmount: true },
  });
  progress.collected = Number(cash._sum.cashAmount ?? 0n);
  return progress;
}

/** Journée du livreur : chargement à recevoir, tournée et livraisons (BR-LIV-01, UC-31). */
@Injectable()
export class DriverRouteService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  async route(actor: AuthUser): Promise<DriverRouteDto> {
    const company = await this.db.company.findFirstOrThrow();
    const open = await this.db.workday.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    const date = open ? dateOnly(open.date) : localDate(new Date(), company.timezone);
    const workday =
      open ??
      (await this.db.workday.findFirst({
        where: { userId: actor.userId, date: toDate(date), deletedAt: null },
      }));
    const [load, route] = await Promise.all([
      this.db.load.findFirst({
        where: { userId: actor.userId, status: 'LOADED', deletedAt: null },
        include: {
          truck: true,
          loadLines: { include: { productVariant: { include: { product: true } } } },
        },
        orderBy: { loadedAt: 'desc' },
      }),
      this.db.deliveryRoute.findFirst({
        where: { deliveryUserId: actor.userId, deliveryDate: toDate(date), deletedAt: null },
        include: { truck: true },
      }),
    ]);
    const deliveries = route ? await this.deliveries(route.id) : [];
    return {
      date,
      workday: workday
        ? { id: workday.id, status: workday.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'CLOSED' }
        : null,
      loadToReceive: load
        ? {
            id: load.id,
            truckCode: load.truck.code,
            lines: load.loadLines.map((l) => ({
              variantId: l.productVariantId,
              ...articleOf(l.productVariant),
              qty: l.loadedQty ?? l.plannedQty,
            })),
          }
        : null,
      route: route
        ? { id: route.id, status: route.status, truckCode: route.truck?.code ?? null }
        : null,
      deliveries,
      progress: route
        ? await routeProgress(this.db as unknown as Tx, route.id)
        : { delivered: 0, partial: 0, failed: 0, pending: 0, collected: 0 },
    };
  }

  /** Stock du camion du livreur, pour les ventes ajoutées. */
  async truckStock(actor: AuthUser): Promise<TruckStockDto[]> {
    const truck = await this.db.warehouse.findFirst({
      where: { type: 'TRUCK', assignedUserId: actor.userId, isActive: true, deletedAt: null },
    });
    if (!truck) return [];
    const rows = await this.db.stock.findMany({
      where: { warehouseId: truck.id, physicalQty: { gt: 0 }, deletedAt: null },
      include: {
        productVariant: {
          include: { product: { include: { productUnits: { where: { deletedAt: null } } } } },
        },
      },
    });
    return rows
      .map((s) => ({
        variantId: s.productVariantId,
        productId: s.productVariant.productId,
        ...articleOf(s.productVariant),
        qty: s.physicalQty,
        units: s.productVariant.product.productUnits
          .filter((u) => u.isActive)
          .map((u) => ({ id: u.id, name: u.name, baseQty: u.baseQty, isBase: u.isBase })),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  private async deliveries(routeId: string): Promise<DriverDeliveryDto[]> {
    const orders = await this.db.order.findMany({
      where: {
        deletedAt: null,
        OR: [{ routeId }, { deliveries: { some: { routeId } } }],
      },
      include: {
        customer: true,
        orderLines: {
          where: { kind: { in: ['NORMAL', 'BONUS'] } },
          include: { productVariant: { include: { product: true } }, unit: true },
          orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
        },
        deliveries: { where: { routeId }, orderBy: { attempt: 'desc' }, take: 1 },
      },
      orderBy: { number: 'asc' },
    });
    return orders.map((o) => ({
      orderId: o.id,
      number: o.number,
      status: o.status,
      totalAmount: Number(o.totalAmount),
      customer: {
        id: o.customer.id,
        name: o.customer.name,
        phone: o.customer.phone,
        address: o.customer.address,
        latitude: o.customer.latitude,
        longitude: o.customer.longitude,
        debtAmount: Number(o.customer.debtAmount),
        isCreditAllowed: o.customer.isCreditAllowed,
        creditLimitAmount: Number(o.customer.creditLimitAmount),
      },
      lines: o.orderLines.map((l) => ({
        lineId: l.id,
        kind: l.kind as 'NORMAL' | 'BONUS',
        variantId: l.productVariantId,
        ...articleOf(l.productVariant),
        unitId: l.unitId,
        unitName: l.unit.name,
        unitBaseQty: l.unit.baseQty,
        preparedQty: Math.floor((l.preparedQty ?? l.orderedQty) / l.unit.baseQty),
        unitPrice: Number(l.unitPrice),
        deliveredQty: l.deliveredQty === null ? null : l.deliveredQty / l.unit.baseQty,
      })),
      delivery: o.deliveries[0]
        ? { number: o.deliveries[0].number, result: o.deliveries[0].result }
        : null,
    }));
  }
}
