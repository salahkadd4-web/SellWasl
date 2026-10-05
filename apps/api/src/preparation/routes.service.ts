import { Inject, Injectable } from '@nestjs/common';
import { launchBlockers } from '@sellwasl/business-rules';
import type { RouteCandidateDto, RouteSummaryDto } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, invalidState, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { fullName, warehouseRef } from '../stock/stock-helpers';
import { routeProgress } from './route-progress';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

interface Group {
  driverId: string | null;
  orders: { id: string; totalAmount: bigint; stockouts: number }[];
  territories: Map<string, { id: string; code: string; name: string; sellerUserId: string | null }>;
}

/**
 * Tournées (BR-PRE-01, BR-PRE-02, UC-61) : avant le lancement, les commandes figées d'une date de
 * livraison sont regroupées par livreur du secteur du client ; la tournée naît au lancement.
 */
@Injectable()
export class RoutesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /** Regroupements à lancer, puis tournées déjà lancées pour cette date. */
  async candidates(date: string): Promise<RouteCandidateDto[]> {
    const tx = this.db as unknown as Tx;
    const groups = await this.groups(tx, date);
    const drafts = await Promise.all(groups.map((g) => this.toCandidate(tx, date, g)));
    const routes = await tx.deliveryRoute.findMany({
      where: { deliveryDate: toDate(date), deletedAt: null },
      include: {
        deliveryUser: true,
        truck: true,
        orders: {
          where: { deletedAt: null },
          include: { customer: { include: { territory: true } }, orderLines: true },
        },
      },
    });
    const launched = routes.map((r) => {
      const territories = new Map(
        r.orders.flatMap((o) =>
          o.customer.territory ? [[o.customer.territory.id, o.customer.territory] as const] : [],
        ),
      );
      const candidate: RouteCandidateDto = {
        routeId: r.id,
        status: r.status,
        deliveryDate: dateOnly(r.deliveryDate),
        driver: {
          id: r.deliveryUser.id,
          code: r.deliveryUser.code,
          name: fullName(r.deliveryUser),
        },
        truck: r.truck ? warehouseRef(r.truck) : null,
        territories: [...territories.values()]
          .map((x) => ({ id: x.id, code: x.code, name: x.name }))
          .sort((a, b) => a.code.localeCompare(b.code)),
        ordersCount: r.orders.length,
        totalAmount: r.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
        stockouts: r.orders.reduce(
          (sum, o) => sum + o.orderLines.filter((l) => l.isStockout && l.kind !== 'PENDING').length,
          0,
        ),
        blockers: [],
      };
      return { ...candidate, routeId: r.id };
    });
    for (const r of launched) r.progress = await routeProgress(tx, r.routeId);
    return [...drafts, ...launched];
  }

  /** Lance la préparation de la tournée d'un livreur : les conditions sont relues ici (BR-PRE-02). */
  async launch(actor: AuthUser, date: string, driverId: string): Promise<RouteCandidateDto> {
    const routeId = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      // Verrou du livreur : deux lancements simultanés de la même tournée ne passent pas tous les deux
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${driverId}::uuid FOR UPDATE`;
      const group = (await this.groups(tx, date)).find((g) => g.driverId === driverId);
      if (!group) throw rule('Aucune commande à préparer pour ce livreur à cette date.');
      const candidate = await this.toCandidate(tx, date, group);
      if (candidate.blockers.length > 0)
        throw rule('La préparation ne peut pas encore être lancée.', {
          blockers: candidate.blockers,
        });
      if (
        await tx.deliveryRoute.findFirst({
          where: { deliveryUserId: driverId, deliveryDate: toDate(date), deletedAt: null },
        })
      )
        throw invalidState('La tournée de ce livreur est déjà lancée pour cette date.');
      const now = new Date();
      await tx.deliveryRoute.create({
        data: {
          id: routeId,
          companyId: actor.companyId,
          deliveryDate: toDate(date),
          status: 'PREPARING',
          launchedAt: now,
          launchedByUserId: actor.userId,
          deliveryUserId: driverId,
          truckId: candidate.truck!.id,
          createdByUserId: actor.userId,
        },
      });
      const updated = await tx.order.updateMany({
        where: { id: { in: group.orders.map((o) => o.id) }, status: 'LOCKED', routeId: null },
        data: { status: 'PREPARING', routeId, version: { increment: 1 } },
      });
      if (updated.count !== group.orders.length)
        throw invalidState('Les commandes ont changé pendant le lancement : réessayez.');
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'route.launch',
          entity: 'DeliveryRoute',
          entityId: routeId,
          after: { date, driverId, orders: group.orders.length },
        },
        tx,
      );
    });
    return (await this.candidates(date)).find((c) => c.routeId === routeId)!;
  }

  /** Tournées à préparer ou à charger, pour le magasinier. */
  async toPrepare(): Promise<RouteSummaryDto[]> {
    const routes = await this.db.deliveryRoute.findMany({
      where: { status: { in: ['PREPARING', 'READY'] }, deletedAt: null },
      include: { deliveryUser: true, truck: true, _count: { select: { orders: true } } },
      orderBy: [{ deliveryDate: 'asc' }, { launchedAt: 'asc' }],
    });
    return routes.map((r) => summary(r, r._count.orders));
  }

  /** Commandes figées sans tournée, livrables à cette date, groupées par livreur du secteur. */
  private async groups(tx: Tx, date: string): Promise<Group[]> {
    const orders = await tx.order.findMany({
      where: { status: 'LOCKED', deliveryDate: toDate(date), routeId: null, deletedAt: null },
      include: { customer: { include: { territory: true } }, orderLines: true },
      orderBy: { number: 'asc' },
    });
    const groups = new Map<string | null, Group>();
    for (const o of orders) {
      const territory = o.customer.territory;
      const driverId = territory?.deliveryUserId ?? null;
      const group: Group = groups.get(driverId) ?? { driverId, orders: [], territories: new Map() };
      group.orders.push({
        id: o.id,
        totalAmount: o.totalAmount,
        stockouts: o.orderLines.filter((l) => l.isStockout && l.kind !== 'PENDING').length,
      });
      if (territory) group.territories.set(territory.id, territory);
      groups.set(driverId, group);
    }
    // Tous les secteurs livrés par le livreur : un vendeur encore en journée dans l'un d'eux
    // ajoutera des commandes à la tournée (BR-PRE-02)
    for (const group of groups.values()) {
      if (!group.driverId) continue;
      const served = await tx.territory.findMany({
        where: { deliveryUserId: group.driverId, deletedAt: null },
      });
      for (const territory of served) group.territories.set(territory.id, territory);
    }
    return [...groups.values()];
  }

  private async toCandidate(tx: Tx, date: string, g: Group): Promise<RouteCandidateDto> {
    const sellers = [...g.territories.values()]
      .map((x) => x.sellerUserId)
      .filter((x): x is string => !!x);
    const [inProgress, pendingSync, pendingLines, driver, truck] = await Promise.all([
      tx.workday.count({
        where: { userId: { in: sellers }, status: 'IN_PROGRESS', deletedAt: null },
      }),
      tx.device.count({
        where: { userId: { in: sellers }, status: 'ACTIVE', pendingOps: { gt: 0 } },
      }),
      tx.orderLine.count({
        where: {
          orderId: { in: g.orders.map((o) => o.id) },
          kind: 'PENDING',
          pendingStatus: 'TO_PROCESS',
        },
      }),
      g.driverId ? tx.user.findFirst({ where: { id: g.driverId } }) : null,
      g.driverId
        ? tx.warehouse.findFirst({
            where: { type: 'TRUCK', assignedUserId: g.driverId, isActive: true, deletedAt: null },
          })
        : null,
    ]);
    return {
      routeId: null,
      status: 'DRAFT',
      deliveryDate: date,
      driver: driver ? { id: driver.id, code: driver.code, name: fullName(driver) } : null,
      truck: truck ? warehouseRef(truck) : null,
      territories: [...g.territories.values()]
        .map((x) => ({ id: x.id, code: x.code, name: x.name }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      ordersCount: g.orders.length,
      totalAmount: g.orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
      stockouts: g.orders.reduce((sum, o) => sum + o.stockouts, 0),
      blockers: launchBlockers({
        inProgressWorkdays: inProgress,
        pendingSyncDevices: pendingSync,
        pendingLines,
        hasDriver: !!driver,
        hasTruck: !driver || !!truck,
      }),
    };
  }
}

export function summary(
  r: Prisma.DeliveryRouteGetPayload<{ include: { deliveryUser: true; truck: true } }>,
  ordersCount: number,
): RouteSummaryDto {
  return {
    id: r.id,
    status: r.status,
    deliveryDate: dateOnly(r.deliveryDate),
    driver: { id: r.deliveryUser.id, code: r.deliveryUser.code, name: fullName(r.deliveryUser) },
    truck: r.truck ? warehouseRef(r.truck) : null,
    ordersCount,
  };
}
