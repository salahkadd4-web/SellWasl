import { Inject, Injectable } from '@nestjs/common';
import type { PendingLineDto } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, invalidState, toDate } from '../field/field-errors';
import { OrderService } from '../field/order.service';
import type { Prisma } from '../generated/prisma/client';
import { StockLedger } from '../stock/stock-ledger.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

/** Commandes dont les lignes en attente peuvent encore être traitées (avant la préparation). */
const OPEN_ORDERS = ['CONFIRMED', 'LOCKED'] as const;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/**
 * Lignes en attente (BR-QUO-06, UC-60) : accepter, c'est autoriser le dépassement du quota — la
 * quantité rejoint la ligne normale et réserve du stock ; refuser en fait une vente perdue.
 */
@Injectable()
export class PendingLinesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly orders: OrderService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
  ) {}

  async list(date?: string): Promise<PendingLineDto[]> {
    const tx = this.db as unknown as Prisma.TransactionClient;
    const [lines, available] = await Promise.all([
      this.db.orderLine.findMany({
        where: {
          kind: 'PENDING',
          pendingStatus: 'TO_PROCESS',
          order: {
            status: { in: [...OPEN_ORDERS] },
            deletedAt: null,
            ...(date ? { orderDate: toDate(date) } : {}),
          },
        },
        include: {
          order: { include: { sellerUser: true, customer: true } },
          product: true,
          productVariant: true,
          unit: true,
        },
        orderBy: [{ order: { orderDate: 'asc' } }, { order: { number: 'asc' } }],
      }),
      this.orders.availableStock(tx),
    ]);
    return lines.map((l) => ({
      id: l.id,
      orderId: l.orderId,
      orderNumber: l.order.number,
      orderDate: dateOnly(l.order.orderDate),
      seller: {
        id: l.order.sellerUser.id,
        code: l.order.sellerUser.code,
        name: fullName(l.order.sellerUser),
      },
      customer: { id: l.order.customer.id, name: l.order.customer.name },
      productName: l.product.name,
      variantName: l.productVariant.isDefault ? null : l.productVariant.name,
      unitName: l.unit.name,
      qty: l.enteredQty,
      unitPrice: Number(l.unitPrice),
      availableStock: available.get(l.productVariantId) ?? 0,
    }));
  }

  async decide(
    actor: AuthUser,
    lineIds: string[],
    decision: 'ACCEPT' | 'REFUSE',
  ): Promise<{ processed: number }> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const lines = await tx.orderLine.findMany({
        where: { id: { in: lineIds }, kind: 'PENDING' },
        include: { order: true },
      });
      if (lines.length !== lineIds.length) throw invalidState('Ligne en attente introuvable.');
      const now = new Date();
      for (const line of lines) {
        if (!(OPEN_ORDERS as readonly string[]).includes(line.order.status))
          throw invalidState('La préparation de cette commande est lancée : trop tard.');
        // Prise atomique : deux superviseurs simultanés ne traitent pas deux fois la même ligne
        const claimed = await tx.orderLine.updateMany({
          where: { id: line.id, pendingStatus: 'TO_PROCESS' },
          data: {
            pendingStatus: decision === 'ACCEPT' ? 'ACCEPTED' : 'REFUSED',
            processedByUserId: actor.userId,
            processedAt: now,
            version: { increment: 1 },
          },
        });
        if (claimed.count === 0) throw invalidState('Cette ligne a déjà été traitée.');
        if (decision === 'ACCEPT') await this.accept(tx, line, actor, now);
        else
          await tx.lostDemand.create({
            data: {
              id: uuidv7(),
              companyId: actor.companyId,
              kind: 'LOST_SALE',
              qty: line.orderedQty,
              date: line.order.orderDate,
              userId: line.order.sellerUserId,
              customerId: line.order.customerId,
              productVariantId: line.productVariantId,
              orderLineId: line.id,
              createdByUserId: actor.userId,
              occurredAt: now,
            },
          });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: decision === 'ACCEPT' ? 'pending_line.accept' : 'pending_line.refuse',
          entity: 'OrderLine',
          after: { lineIds },
        },
        tx,
      );
    });
    return { processed: lineIds.length };
  }

  /** La quantité en attente rejoint la ligne normale de l'article et réserve du stock. */
  private async accept(
    tx: Prisma.TransactionClient,
    line: Prisma.OrderLineGetPayload<{ include: { order: true } }>,
    actor: AuthUser,
    now: Date,
  ) {
    const companyId = actor.companyId;
    const depot = await this.orders.depot(tx);
    const balance = (
      await this.ledger.balances(tx, companyId, depot.id, [line.productVariantId])
    ).get(line.productVariantId)!;
    const take = Math.max(0, Math.min(line.orderedQty, balance.physical - balance.reserved));
    if (take > 0)
      await this.ledger.apply(
        tx,
        actor,
        [
          {
            type: 'RESERVATION',
            variantId: line.productVariantId,
            qty: take,
            toWarehouseId: depot.id,
            source: { type: 'ORDER', id: line.orderId },
          },
        ],
        now,
      );

    const normal = await tx.orderLine.findFirst({
      where: { orderId: line.orderId, productVariantId: line.productVariantId, kind: 'NORMAL' },
    });
    if (normal) {
      const enteredQty = normal.enteredQty + line.enteredQty;
      const orderedQty = normal.orderedQty + line.orderedQty;
      const reservedQty = normal.reservedQty + take;
      await tx.orderLine.update({
        where: { id: normal.id },
        data: {
          enteredQty,
          orderedQty,
          reservedQty,
          lineAmount: normal.unitPrice * BigInt(enteredQty),
          isStockout: reservedQty < orderedQty,
          version: { increment: 1 },
        },
      });
    } else {
      await tx.orderLine.create({
        data: {
          id: uuidv7(),
          companyId,
          orderId: line.orderId,
          kind: 'NORMAL',
          enteredQty: line.enteredQty,
          orderedQty: line.orderedQty,
          reservedQty: take,
          unitPrice: line.unitPrice,
          lineAmount: line.unitPrice * BigInt(line.enteredQty),
          isStockout: take < line.orderedQty,
          productId: line.productId,
          productVariantId: line.productVariantId,
          unitId: line.unitId,
          priceTierId: line.priceTierId,
          occurredAt: new Date(),
        },
      });
    }
    // Le montant compte la ligne acceptée (BR-CMD-03)
    await tx.order.update({
      where: { id: line.orderId },
      data: {
        totalAmount: { increment: line.unitPrice * BigInt(line.enteredQty) },
        version: { increment: 1 },
      },
    });
  }
}
