import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { minimumCash } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  deliveryConfirmPayload,
  type DeliveryPreviewDto,
  type deliveryPreviewSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { invalidState, rule } from '../field/field-errors';
import { WorkdayService } from '../field/workday.service';
import type { Prisma } from '../generated/prisma/client';
import { OrderRepricer } from '../preparation/order-repricer.service';
import { articleName, articleOf, toBaseLines } from '../stock/stock-helpers';
import { type Move, StockLedger } from '../stock/stock-ledger.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;
type Content = z.output<typeof deliveryPreviewSchema>;

const ORDER = {
  customer: true,
  route: true,
  orderLines: {
    where: { kind: { in: ['NORMAL', 'BONUS'] } },
    include: { productVariant: { include: { product: true } }, unit: true },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.OrderInclude;
type LoadedOrder = Prisma.OrderGetPayload<{ include: typeof ORDER }>;

interface Computed {
  order: LoadedOrder;
  /** Ligne existante → quantité livrée (unité de la ligne), prix, quantité ajoutée fusionnée. */
  lines: {
    line: LoadedOrder['orderLines'][number];
    qty: number;
    added: number;
    unitPrice: bigint;
  }[];
  fresh: { variantId: string; unitId: string; qty: number; productId: string; unitPrice: bigint }[];
  decreased: boolean;
  due: number;
  minimum: number;
}

/**
 * Livraison d'une commande par le livreur (UC-32, BR-LIV-02, BR-PAY-03) : quantités livrées,
 * produits ajoutés depuis le camion, paliers et bonus recalculés, encaissement, sortie du camion.
 */
@Injectable()
export class DeliveryService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly workdays: WorkdayService,
    private readonly repricer: OrderRepricer,
    private readonly ledger: StockLedger,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('delivery.confirm', 'deliveries.own', deliveryConfirmPayload, (ctx) =>
      this.confirm(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
  }

  /** Aperçu chiffré, sans rien écrire : le livreur sait combien encaisser. */
  async preview(actor: AuthUser, input: Content): Promise<DeliveryPreviewDto> {
    const c = await this.compute(this.db as unknown as Tx, actor, input);
    const unitOf = (unitId: string) =>
      c.order.orderLines.find((l) => l.unitId === unitId)?.unit.name ?? '';
    const freshNames = await toBaseLines(
      this.db as unknown as Tx,
      c.fresh.map((f) => ({ variantId: f.variantId, unitId: f.unitId, qty: f.qty })),
    );
    return {
      lines: [
        ...c.lines.map((l) => ({
          lineId: l.line.id,
          kind: l.line.kind as 'NORMAL' | 'BONUS',
          variantId: l.line.productVariantId,
          ...articleOf(l.line.productVariant),
          unitName: l.line.unit.name,
          qty: l.qty,
          unitPrice: Number(l.unitPrice),
          amount: Number(l.unitPrice) * l.qty,
        })),
        ...c.fresh.map((f, i) => ({
          lineId: null,
          kind: 'NORMAL' as const,
          variantId: f.variantId,
          productName: freshNames[i]!.article,
          variantName: null,
          unitName: freshNames[i]!.unitName || unitOf(f.unitId),
          qty: f.qty,
          unitPrice: Number(f.unitPrice),
          amount: Number(f.unitPrice) * f.qty,
        })),
      ],
      dueAmount: c.due,
      minimumCash: c.minimum,
      debtAmount: Number(c.order.customer.debtAmount),
    };
  }

  private async confirm(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof deliveryConfirmPayload>,
    occurredAt: Date,
  ) {
    const workday = await this.workdays.openWorkday(tx, actor);
    // Verrou de la commande : deux confirmations simultanées ne livrent pas deux fois
    await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${payload.orderId}::uuid FOR UPDATE`;
    if (await tx.delivery.findFirst({ where: { number: payload.number } }))
      throw new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', `Le bon ${payload.number} existe déjà.`);
    const c = await this.compute(tx, actor, payload);
    if (payload.cashAmount < c.minimum)
      throw rule(`Encaissez au moins ${c.minimum} DA (plafond de crédit du client).`, {
        rule: 'BR-PAY-03',
        minimumCash: c.minimum,
      });
    if (payload.cashAmount > c.due) throw rule('Le montant encaissé dépasse le montant dû.');
    const credit = c.due - payload.cashAmount;

    const moves: Move[] = [];
    const out = (variantId: string, qty: number) => {
      if (qty > 0)
        moves.push({
          type: 'OUT',
          variantId,
          qty,
          fromWarehouseId: c.order.route!.truckId!,
          source: { type: 'DELIVERY', id: payload.deliveryId },
        });
    };
    for (const l of c.lines) {
      const base = l.qty * l.line.unit.baseQty;
      out(l.line.productVariantId, base);
      await tx.orderLine.update({
        where: { id: l.line.id },
        data: {
          ...(l.added > 0
            ? {
                enteredQty: l.line.enteredQty + l.added,
                orderedQty: l.line.orderedQty + l.added * l.line.unit.baseQty,
              }
            : {}),
          deliveredQty: base,
          unitPrice: l.unitPrice,
          lineAmount: l.line.kind === 'BONUS' ? 0n : l.unitPrice * BigInt(l.qty),
          version: { increment: 1 },
        },
      });
    }
    const units = await tx.productUnit.findMany({
      where: { id: { in: c.fresh.map((f) => f.unitId) } },
    });
    for (const f of c.fresh) {
      const base = f.qty * units.find((u) => u.id === f.unitId)!.baseQty;
      out(f.variantId, base);
      await tx.orderLine.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          orderId: c.order.id,
          kind: 'NORMAL',
          enteredQty: f.qty,
          orderedQty: base,
          deliveredQty: base,
          unitPrice: f.unitPrice,
          lineAmount: f.unitPrice * BigInt(f.qty),
          productId: f.productId,
          productVariantId: f.variantId,
          unitId: f.unitId,
          occurredAt,
        },
      });
    }
    // Sortie du camion : refusée s'il n'a pas la marchandise (BR-STK-04)
    await this.ledger.apply(tx, actor, moves, occurredAt);

    const result = c.decreased ? 'PARTIAL' : 'DELIVERED';
    const attempt = (await tx.delivery.count({ where: { orderId: c.order.id } })) + 1;
    await tx.delivery.create({
      data: {
        id: payload.deliveryId,
        companyId: actor.companyId,
        number: payload.number,
        attempt,
        result,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        deliveredAmount: BigInt(c.due),
        orderId: c.order.id,
        routeId: c.order.routeId,
        workdayId: workday.id,
        userId: actor.userId,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    const paymentId = uuidv7();
    await tx.payment.create({
      data: {
        id: paymentId,
        companyId: actor.companyId,
        number: payload.number,
        kind: 'DELIVERY_PAYMENT',
        dueAmount: BigInt(c.due),
        cashAmount: BigInt(payload.cashAmount),
        creditAmount: BigInt(credit),
        customerId: c.order.customerId,
        userId: actor.userId,
        workdayId: workday.id,
        orderId: c.order.id,
        deliveryId: payload.deliveryId,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    let debt = c.order.customer.debtAmount;
    if (credit > 0) {
      await tx.customerDebtEntry.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          customerId: c.order.customerId,
          kind: 'CREDIT_SALE',
          amount: BigInt(credit),
          occurredAt,
          paymentId,
        },
      });
      debt = (
        await tx.customer.update({
          where: { id: c.order.customerId },
          data: { debtAmount: { increment: BigInt(credit) }, version: { increment: 1 } },
        })
      ).debtAmount;
    }
    await tx.order.update({
      where: { id: c.order.id },
      data: {
        status: result === 'PARTIAL' ? 'PARTIALLY_DELIVERED' : 'DELIVERED',
        totalAmount: BigInt(c.due),
        version: { increment: 1 },
      },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'delivery.confirm',
        entity: 'Delivery',
        entityId: payload.deliveryId,
        after: {
          orderId: c.order.id,
          result,
          due: c.due,
          cash: payload.cashAmount,
          credit,
          added: c.fresh.length + c.lines.filter((l) => l.added > 0).length,
        },
      },
      tx,
    );
    return {
      deliveryId: payload.deliveryId,
      number: payload.number,
      result,
      dueAmount: c.due,
      cashAmount: payload.cashAmount,
      creditAmount: credit,
      debtAmount: Number(debt),
    };
  }

  /** Quantités livrées, ajouts, prix et minimum à encaisser — commun à l'aperçu et à la livraison. */
  private async compute(tx: Tx, actor: AuthUser, input: Content): Promise<Computed> {
    const order = await tx.order.findFirst({
      where: { id: input.orderId, deletedAt: null },
      include: ORDER,
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.route?.deliveryUserId !== actor.userId)
      throw invalidState('Cette commande ne fait pas partie de votre tournée.');
    if (order.status !== 'OUT_FOR_DELIVERY')
      throw invalidState('Cette commande n’est pas en livraison.');

    const normals = order.orderLines.filter((l) => l.kind === 'NORMAL');
    const bonuses = order.orderLines.filter((l) => l.kind === 'BONUS');
    const delivered = new Map(input.lines.map((l) => [l.lineId, l.qty]));
    if (normals.some((l) => !delivered.has(l.id)))
      throw rule('Indiquez la quantité livrée de chaque ligne.');
    if (input.lines.some((l) => !normals.some((n) => n.id === l.lineId)))
      throw rule('Une ligne ne fait pas partie de cette commande.');
    const prepared = (l: LoadedOrder['orderLines'][number]) =>
      Math.floor((l.preparedQty ?? l.orderedQty) / l.unit.baseQty);
    for (const l of normals)
      if (delivered.get(l.id)! > prepared(l))
        throw rule(`Livré au-delà du préparé : ${articleName(l.productVariant)}.`);
    // Unité de chaque produit ajouté : celle de son produit
    await toBaseLines(tx, input.added);

    const settingsRow = await tx.companySettings.findFirst({ orderBy: { version: 'desc' } });
    const p04 = companySettingsSchema.parse(settingsRow?.data ?? {}).rules
      .P04_recalculateOnDecrease;
    const decreased = normals.some((l) => delivered.get(l.id)! < prepared(l));
    const priced = await this.repricer.reprice(
      order,
      normals.map((l) => ({
        id: l.id,
        variantId: l.productVariantId,
        unitId: l.unitId,
        unitPrice: l.unitPrice,
        qty: delivered.get(l.id)!,
      })),
      bonuses.map((b) => ({
        id: b.id,
        bonusRuleId: b.bonusRuleId,
        variantId: b.productVariantId,
        maxQty: prepared(b),
      })),
      input.added,
      p04 && decreased,
    );
    const addedTo = (l: LoadedOrder['orderLines'][number]) =>
      input.added
        .filter((a) => a.variantId === l.productVariantId)
        .reduce((sum, a) => sum + a.qty, 0);
    const lines = [
      ...normals.map((l) => ({
        line: l,
        added: addedTo(l),
        qty: delivered.get(l.id)! + addedTo(l),
        unitPrice: priced.prices.get(l.id)!,
      })),
      ...bonuses.map((b) => ({ line: b, added: 0, qty: priced.bonus.get(b.id)!, unitPrice: 0n })),
    ];
    const due =
      lines
        .filter((l) => l.line.kind === 'NORMAL')
        .reduce((sum, l) => sum + Number(l.unitPrice) * l.qty, 0) +
      priced.added.reduce((sum, f) => sum + Number(f.unitPrice) * f.qty, 0);
    return {
      order,
      lines,
      fresh: priced.added,
      decreased,
      due,
      minimum: minimumCash({
        due,
        isCreditAllowed: order.customer.isCreditAllowed,
        creditLimit: Number(order.customer.creditLimitAmount),
        debt: Number(order.customer.debtAmount),
      }),
    };
  }
}
