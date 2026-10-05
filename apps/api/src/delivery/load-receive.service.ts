import { Injectable, type OnModuleInit } from '@nestjs/common';
import { loadReceivePayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { invalidState, rule } from '../field/field-errors';
import { WorkdayService } from '../field/workday.service';
import type { Prisma } from '../generated/prisma/client';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { SyncHandlers } from '../sync/sync.handlers';

type Tx = Prisma.TransactionClient;

/**
 * Réception d'un chargement par le livreur ou le vendeur cash van (UC-30, BR-PRE-05) : un écart
 * est ajusté sur le camion et signalé ; il livre ce qu'il a reçu. Les commandes de la tournée
 * partent en livraison.
 */
@Injectable()
export class LoadReceiveService implements OnModuleInit {
  constructor(
    private readonly workdays: WorkdayService,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('load.receive', 'loads.receive', loadReceivePayload, (ctx) =>
      this.receive(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
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
    if (load.routeId) {
      await tx.order.updateMany({
        where: { routeId: load.routeId, status: 'READY', deletedAt: null },
        data: { status: 'OUT_FOR_DELIVERY', version: { increment: 1 } },
      });
      await tx.deliveryRoute.update({
        where: { id: load.routeId },
        data: { status: 'OUT_FOR_DELIVERY', version: { increment: 1 } },
      });
    }
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
    return { loadId: load.id, hasGap: moves.length > 0 };
  }
}
