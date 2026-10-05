import { Inject, Injectable } from '@nestjs/common';
import type { LoadDto } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { invalidState } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { LoadsService } from '../stock/loads.service';
import { activeWarehouse } from '../stock/stock-helpers';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

/**
 * Chargement d'une tournée préparée (BR-PRE-04, UC-42) : le préparé part du dépôt vers le camion
 * du livreur, et ce transfert remplace la réservation.
 */
@Injectable()
export class RouteLoadService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly ledger: StockLedger,
    private readonly loads: LoadsService,
    private readonly audit: AuditService,
  ) {}

  async load(actor: AuthUser, routeId: string): Promise<LoadDto> {
    const loadId = uuidv7();
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.$queryRaw`SELECT id FROM delivery_route WHERE id = ${routeId}::uuid FOR UPDATE`;
      const route = await tx.deliveryRoute.findFirst({ where: { id: routeId, deletedAt: null } });
      if (!route) throw notFound('Tournée introuvable.');
      if (route.status !== 'READY')
        throw invalidState(
          route.status === 'PREPARING'
            ? 'Préparez la tournée avant de la charger.'
            : 'Cette tournée est déjà chargée.',
        );
      const truck = await activeWarehouse(tx, route.truckId ?? '', 'TRUCK');
      const depot = await this.ledger.mainDepot(tx);
      const lines = await tx.orderLine.findMany({
        where: {
          order: { routeId, deletedAt: null },
          kind: { in: ['NORMAL', 'BONUS'] },
          preparedQty: { gt: 0 },
        },
      });
      const totals = new Map<string, number>();
      for (const l of lines)
        totals.set(l.productVariantId, (totals.get(l.productVariantId) ?? 0) + l.preparedQty!);
      // Dépôt et camion verrouillés ensemble, dans l'ordre du registre
      await this.ledger.balances(tx, actor.companyId, depot.id, [...totals.keys()], [truck.id]);

      const moves: Move[] = [
        ...lines
          .filter((l) => l.reservedQty > 0)
          .map((l) => ({
            type: 'RELEASE' as const,
            variantId: l.productVariantId,
            qty: l.reservedQty,
            fromWarehouseId: depot.id,
            source: { type: 'ORDER' as const, id: l.orderId },
          })),
        ...[...totals].map(([variantId, qty]) => ({
          type: 'TRANSFER' as const,
          variantId,
          qty,
          fromWarehouseId: depot.id,
          toWarehouseId: truck.id,
          source: { type: 'LOAD' as const, id: loadId },
        })),
      ];
      const now = new Date();
      await tx.load.create({
        data: {
          id: loadId,
          companyId: actor.companyId,
          kind: 'ROUTE',
          date: route.deliveryDate,
          status: 'LOADED',
          loadedByUserId: actor.userId,
          loadedAt: now,
          occurredAt: now,
          truckId: truck.id,
          userId: route.deliveryUserId,
          routeId,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          loadLines: {
            create: [...totals].map(([variantId, qty]) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              productVariantId: variantId,
              plannedQty: qty,
              loadedQty: qty,
            })),
          },
        },
      });
      await this.ledger.apply(tx, actor, moves, now);
      await tx.orderLine.updateMany({
        where: { id: { in: lines.map((l) => l.id) } },
        data: { reservedQty: 0, version: { increment: 1 } },
      });
      await tx.deliveryRoute.update({
        where: { id: routeId },
        data: { status: 'LOADED', version: { increment: 1 } },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          deviceId: actor.deviceId,
          action: 'load.validate',
          entity: 'Load',
          entityId: loadId,
          after: { routeId, truckId: truck.id, lines: [...totals] },
        },
        tx,
      );
    });
    return this.loads.get(loadId);
  }
}
