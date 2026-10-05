import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { lostDemandPayload, saleConfirmPayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, invalidState, rule } from '../field/field-errors';
import { OrderService } from '../field/order.service';
import { VisitService } from '../field/visit.service';
import { WorkdayService } from '../field/workday.service';
import type { Prisma } from '../generated/prisma/client';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { assertTruckChecked } from './load-receive.service';
import { recordDeliveryPayment } from './payments';

type Tx = Prisma.TransactionClient;

/**
 * Vente cash van (UC-15, BR-CV-03, BR-CV-04, BR-CV-05) : depuis le stock du camion, livrée tout de
 * suite, payée, définitive. Quota épuisé : la vente est refusée et le vendeur peut enregistrer une
 * demande perdue (BR-QUO-04).
 */
@Injectable()
export class SaleService implements OnModuleInit {
  constructor(
    private readonly workdays: WorkdayService,
    private readonly visits: VisitService,
    private readonly orders: OrderService,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('sale.confirm', 'sales.own', saleConfirmPayload, (ctx) =>
      this.confirm(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('lost_demand.create', 'lost_demands.own', lostDemandPayload, (ctx) =>
      this.lostDemand(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
  }

  private async confirm(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof saleConfirmPayload>,
    occurredAt: Date,
  ) {
    const workday = await this.workdays.openWorkday(tx, actor);
    await assertTruckChecked(tx, actor.userId);
    const visit = await tx.visit.findFirst({
      where: { id: payload.visitId, userId: actor.userId, deletedAt: null },
      include: { order: true },
    });
    if (!visit || visit.status !== 'IN_PROGRESS')
      throw invalidState('Commencez la visite du client avant de lui vendre.');
    if (visit.mode !== 'ON_SITE') throw invalidState('Une vente cash van se fait sur place.');
    if (visit.order) throw invalidState('Cette visite a déjà une vente.');
    if (
      (await tx.order.findFirst({ where: { number: payload.number } })) ||
      (await tx.delivery.findFirst({ where: { number: payload.number } }))
    )
      throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', `Le bon ${payload.number} existe déjà.`);
    const customer = await this.visits.sectorCustomer(tx, actor, visit.customerId);
    const truck = await tx.warehouse.findFirst({
      where: { type: 'TRUCK', assignedUserId: actor.userId, isActive: true, deletedAt: null },
    });
    if (!truck) throw rule("Vous n'avez pas de camion : voyez votre superviseur.");

    // Prix du type du client, bonus limités par le camion (BR-CV-03)
    const { lines } = await this.orders.build(tx, actor, {
      customerTypeId: customer.customerTypeId,
      date: dateOnly(workday.date),
      lines: payload.lines,
      freeVariantChoices: payload.freeVariantChoices,
      availableStock: await this.orders.truckStock(tx, actor.userId),
    });
    if (lines.some((l) => l.kind === 'PENDING'))
      throw rule('Quota épuisé pour un article : la quantité dépasse le reste du quota.', {
        rule: 'BR-QUO-04',
      });

    const deliveryId = uuidv7();
    const due = lines
      .filter((l) => l.kind === 'NORMAL')
      .reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
    await tx.order.create({
      data: {
        id: payload.orderId,
        companyId: actor.companyId,
        number: payload.number,
        source: 'CASH_VAN',
        status: 'DELIVERED',
        orderDate: workday.date,
        deliveryDate: workday.date,
        confirmedAt: occurredAt,
        totalAmount: BigInt(due),
        sellerUserId: actor.userId,
        customerId: customer.id,
        customerTypeId: customer.customerTypeId,
        visitId: visit.id,
        workdayId: workday.id,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    await tx.orderLine.createMany({
      data: lines.map((l) => ({
        id: uuidv7(),
        companyId: actor.companyId,
        orderId: payload.orderId,
        kind: l.kind,
        enteredQty: l.qty,
        orderedQty: l.baseQty,
        preparedQty: l.baseQty,
        deliveredQty: l.baseQty,
        unitPrice: BigInt(l.unitPrice),
        lineAmount: BigInt(l.unitPrice * l.qty),
        productId: l.productId,
        productVariantId: l.variantId,
        unitId: l.unitId,
        bonusRuleId: l.bonusRuleId,
        occurredAt,
      })),
    });
    // Vente = livraison : la marchandise sort du camion (BR-CV-04) ; refusée s'il ne l'a pas
    const moves: Move[] = lines.map((l) => ({
      type: 'OUT',
      variantId: l.variantId,
      qty: l.baseQty,
      fromWarehouseId: truck.id,
      source: { type: 'DELIVERY', id: deliveryId },
    }));
    await this.ledger.apply(tx, actor, moves, occurredAt);
    await tx.delivery.create({
      data: {
        id: deliveryId,
        companyId: actor.companyId,
        number: payload.number,
        result: 'DELIVERED',
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        deliveredAmount: BigInt(due),
        orderId: payload.orderId,
        workdayId: workday.id,
        userId: actor.userId,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    const { credit, debt } = await recordDeliveryPayment(tx, {
      companyId: actor.companyId,
      number: payload.number,
      due,
      cash: payload.cashAmount,
      customer,
      userId: actor.userId,
      deviceId: actor.deviceId,
      workdayId: workday.id,
      orderId: payload.orderId,
      deliveryId,
      occurredAt,
    });
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: 'COMPLETED',
        outcome: 'ORDER',
        endedAt: occurredAt,
        version: { increment: 1 },
      },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'sale.confirm',
        entity: 'Order',
        entityId: payload.orderId,
        after: { number: payload.number, due, cash: payload.cashAmount, credit },
      },
      tx,
    );
    return {
      orderId: payload.orderId,
      number: payload.number,
      totalAmount: due,
      cashAmount: payload.cashAmount,
      creditAmount: credit,
      debtAmount: Number(debt),
    };
  }

  /** Demande perdue : le client voulait un produit que le vendeur ne pouvait pas vendre. */
  private async lostDemand(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof lostDemandPayload>,
    occurredAt: Date,
  ) {
    const workday = await this.workdays.openWorkday(tx, actor);
    const customer = await this.visits.sectorCustomer(tx, actor, payload.customerId);
    await tx.lostDemand.create({
      data: {
        id: payload.lostDemandId,
        companyId: actor.companyId,
        kind: 'LOST_DEMAND',
        qty: payload.qty,
        date: workday.date,
        userId: actor.userId,
        customerId: customer.id,
        productVariantId: payload.variantId,
        createdByUserId: actor.userId,
        occurredAt,
      },
    });
    return { lostDemandId: payload.lostDemandId };
  }
}
