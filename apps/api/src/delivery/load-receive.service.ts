import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { loadReceivePayload, type TruckCheckLine, truckCheckPayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { invalidState, rule } from '../field/field-errors';
import { WorkdayService } from '../field/workday.service';
import type { Prisma } from '../generated/prisma/client';
import { articleOf } from '../stock/stock-helpers';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

/** Une tournée dont le chargement est reçu part en livraison (BR-PRE-05). */
async function startRoute(tx: Tx, routeId: string) {
  await tx.order.updateMany({
    where: { routeId, status: 'READY', deletedAt: null },
    data: { status: 'OUT_FOR_DELIVERY', version: { increment: 1 } },
  });
  await tx.deliveryRoute.update({
    where: { id: routeId },
    data: { status: 'OUT_FOR_DELIVERY', version: { increment: 1 } },
  });
}

/** Refuse de livrer ou de vendre tant qu'un chargement n'est pas pointé (BR-CV-02). */
export async function assertTruckChecked(tx: Pick<Tx, 'load'>, userId: string) {
  if (await tx.load.findFirst({ where: { userId, status: 'LOADED', deletedAt: null } }))
    throw invalidState("Pointez d'abord votre camion : un chargement attend votre réception.");
}

/**
 * Réception d'un chargement par le livreur ou le vendeur cash van (UC-30, BR-PRE-05) : un écart
 * est ajusté sur le camion et signalé ; il livre ce qu'il a reçu. Les commandes de la tournée
 * partent en livraison.
 */
@Injectable()
export class LoadReceiveService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly workdays: WorkdayService,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('load.receive', 'loads.receive', loadReceivePayload, (ctx) =>
      this.receive(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('truck.check', 'loads.receive', truckCheckPayload, (ctx) =>
      this.check(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
  }

  /** Lignes à pointer : stock du camion et chargements à recevoir. */
  async checkLines(actor: AuthUser): Promise<TruckCheckLine[]> {
    const tx = this.db as unknown as Tx;
    const truck = await this.truck(tx, actor);
    const [stock, pending] = await Promise.all([
      tx.stock.findMany({ where: { warehouseId: truck.id, deletedAt: null } }),
      tx.loadLine.findMany({
        where: { load: { userId: actor.userId, status: 'LOADED', deletedAt: null } },
      }),
    ]);
    const ids = new Set([
      ...stock.filter((s) => s.physicalQty > 0).map((s) => s.productVariantId),
      ...pending.map((l) => l.productVariantId),
    ]);
    const variants = await tx.productVariant.findMany({
      where: { id: { in: [...ids] } },
      include: { product: true },
    });
    return variants
      .map((v) => ({
        variantId: v.id,
        ...articleOf(v),
        inTruck: stock.find((s) => s.productVariantId === v.id)?.physicalQty ?? 0,
        toReceive: pending
          .filter((l) => l.productVariantId === v.id)
          .reduce((sum, l) => sum + (l.loadedQty ?? l.plannedQty), 0),
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  private async truck(tx: Tx, actor: AuthUser) {
    const truck = await tx.warehouse.findFirst({
      where: { type: 'TRUCK', assignedUserId: actor.userId, isActive: true, deletedAt: null },
    });
    if (!truck) throw rule("Vous n'avez pas de camion : voyez votre superviseur.");
    return truck;
  }

  /**
   * Pointage du camion au démarrage (BR-CV-02, BR-PRE-05) : tout le stock du camion, chargements
   * du jour et stock resté de la veille ; chaque écart est ajusté, les chargements sont reçus.
   */
  private async check(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof truckCheckPayload>,
    occurredAt: Date,
  ) {
    await this.workdays.openWorkday(tx, actor);
    const truck = await this.truck(tx, actor);
    const loads = await tx.load.findMany({
      where: { userId: actor.userId, status: 'LOADED', deletedAt: null },
      include: { loadLines: true },
    });
    const stock = await tx.stock.findMany({ where: { warehouseId: truck.id, deletedAt: null } });
    const expected = new Set([
      ...stock.filter((s) => s.physicalQty > 0).map((s) => s.productVariantId),
      ...loads.flatMap((l) => l.loadLines.map((x) => x.productVariantId)),
    ]);
    const counted = new Map(payload.lines.map((l) => [l.variantId, l.countedQty]));
    if ([...expected].some((v) => !counted.has(v))) throw rule('Pointez chaque article du camion.');
    const balances = await this.ledger.balances(tx, actor.companyId, truck.id, [...counted.keys()]);
    const reasons = await tx.reason.findMany({ where: { kind: 'ADJUSTMENT', deletedAt: null } });
    const missingReason = reasons.find((r) => r.label === 'Marchandise manquante')?.id;
    const otherReason = reasons.find((r) => r.systemCode === 'OTHER')?.id;
    const source = loads[0] ? { type: 'LOAD' as const, id: loads[0].id } : undefined;
    const moves: Move[] = [];
    for (const [variantId, qty] of counted) {
      const gap = qty - balances.get(variantId)!.physical;
      if (gap !== 0)
        moves.push({
          type: 'ADJUSTMENT',
          variantId,
          qty: Math.abs(gap),
          ...(gap < 0
            ? { fromWarehouseId: truck.id, reasonId: missingReason }
            : { toWarehouseId: truck.id, reasonId: otherReason }),
          source,
        });
    }
    await this.ledger.apply(tx, actor, moves, occurredAt);
    for (const load of loads) {
      for (const line of load.loadLines)
        await tx.loadLine.update({
          where: { id: line.id },
          data: { receivedQty: line.loadedQty ?? line.plannedQty, version: { increment: 1 } },
        });
      await tx.load.update({
        where: { id: load.id },
        data: {
          status: 'RECEIVED',
          receivedAt: occurredAt,
          hasGap: moves.length > 0,
          version: { increment: 1 },
        },
      });
      if (load.routeId) await startRoute(tx, load.routeId);
    }
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'truck.check',
        entity: 'Warehouse',
        entityId: truck.id,
        after: {
          loads: loads.map((l) => l.id),
          gaps: moves.map((m) => [m.variantId, m.fromWarehouseId ? -m.qty : m.qty]),
        },
      },
      tx,
    );
    if (moves.length > 0) await this.notifyGap(tx, actor);
    return { hasGap: moves.length > 0, loads: loads.length };
  }

  private async receive(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof loadReceivePayload>,
    occurredAt: Date,
  ) {
    await this.workdays.openWorkday(tx, actor);
    await tx.$queryRaw`SELECT id FROM "load" WHERE id = ${payload.loadId}::uuid FOR UPDATE`;
    const load = await tx.load.findFirst({
      where: { id: payload.loadId, userId: actor.userId, deletedAt: null },
      include: { loadLines: true },
    });
    if (!load) throw notFound('Chargement introuvable.');
    if (load.status !== 'LOADED') throw invalidState('Ce chargement est déjà reçu.');

    const received = new Map(payload.lines.map((l) => [l.variantId, l.receivedQty]));
    if (payload.lines.some((l) => !load.loadLines.some((x) => x.productVariantId === l.variantId)))
      throw rule('Un article ne fait pas partie de ce chargement.');
    const reasons = await tx.reason.findMany({ where: { kind: 'ADJUSTMENT', deletedAt: null } });
    const missingReason = reasons.find((r) => r.label === 'Marchandise manquante')?.id;
    const otherReason = reasons.find((r) => r.systemCode === 'OTHER')?.id;

    const moves: Move[] = [];
    for (const line of load.loadLines) {
      const loaded = line.loadedQty ?? line.plannedQty;
      const got = received.get(line.productVariantId) ?? loaded;
      const gap = got - loaded;
      if (gap !== 0)
        moves.push({
          type: 'ADJUSTMENT',
          variantId: line.productVariantId,
          qty: Math.abs(gap),
          ...(gap < 0
            ? { fromWarehouseId: load.truckId, reasonId: missingReason }
            : { toWarehouseId: load.truckId, reasonId: otherReason }),
          source: { type: 'LOAD', id: load.id },
        });
      await tx.loadLine.update({
        where: { id: line.id },
        data: { receivedQty: got, version: { increment: 1 } },
      });
    }
    await this.ledger.apply(tx, actor, moves, occurredAt);
    await tx.load.update({
      where: { id: load.id },
      data: {
        status: 'RECEIVED',
        receivedAt: occurredAt,
        hasGap: moves.length > 0,
        version: { increment: 1 },
      },
    });
    if (load.routeId) await startRoute(tx, load.routeId);
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'load.receive',
        entity: 'Load',
        entityId: load.id,
        after: { gaps: moves.map((m) => [m.variantId, m.fromWarehouseId ? -m.qty : m.qty]) },
      },
      tx,
    );
    if (moves.length > 0) await this.notifyGap(tx, actor);
    return { loadId: load.id, hasGap: moves.length > 0 };
  }

  /** Écart au pointage ou à la réception du camion (BR-NOT-02). */
  private async notifyGap(tx: Tx, actor: AuthUser) {
    await this.notifications.notify(tx, {
      companyId: actor.companyId,
      type: 'LOAD_GAP',
      title: 'Écart au chargement',
      body: `${await this.notifications.userLabel(tx, actor.userId)} a pointé son camion avec un écart.`,
      data: { href: '/app/stock' },
      to: { permission: 'loads.read' },
      actorUserId: actor.userId,
    });
  }
}
