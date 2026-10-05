import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type CartLineInput,
  nextWorkingDay,
  priceCart,
  type PricingCatalog,
  splitByQuota,
  type WeekdayCode,
} from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type OrderDto,
  orderCancelPayload,
  orderConfirmPayload,
  orderUpdatePayload,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { PricingService } from '../catalog/pricing.service';
import type { Prisma } from '../generated/prisma/client';
import { StockLedger, type Move } from '../stock/stock-ledger.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { dateOnly, invalidState, rule, toDate } from './field-errors';
import { VisitService } from './visit.service';
import { WorkdayService } from './workday.service';

type Tx = Prisma.TransactionClient;
type ConfirmPayload = z.output<typeof orderConfirmPayload>;
type UpdatePayload = z.output<typeof orderUpdatePayload>;

/** Statuts dont les quantités normales consomment le quota du jour (BR-QUO-02). */
const QUOTA_STATUSES = [
  'CONFIRMED',
  'LOCKED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
] as const;

/** Ligne prête à enregistrer, avec ses quantités en unité saisie et en unité de base. */
interface BuiltLine {
  kind: 'NORMAL' | 'PENDING' | 'BONUS';
  productId: string;
  variantId: string;
  unitId: string;
  qty: number;
  baseQty: number;
  unitPrice: number;
  tierMinQty: number | null;
  bonusRuleId: string | null;
  customerTypeId: string;
}

const dup = (message: string) => new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', message);
const validation = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message);

/**
 * Commandes de prévente (BR-CMD, UC-14, UC-17) : le serveur recalcule le panier avec la grille en
 * vigueur, scinde au quota, réserve le stock du dépôt et fige le résultat.
 */
@Injectable()
export class OrderService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly pricing: PricingService,
    private readonly workdays: WorkdayService,
    private readonly visits: VisitService,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
    private readonly ledger: StockLedger,
  ) {}

  onModuleInit(): void {
    this.handlers.register('order.confirm', 'orders.own', orderConfirmPayload, (ctx) =>
      this.confirm(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('order.update', 'orders.own', orderUpdatePayload, (ctx) =>
      this.update(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('order.cancel', 'orders.own', orderCancelPayload, (ctx) =>
      this.cancel(ctx.actor, ctx.tx, ctx.payload.orderId, new Date(ctx.op.occurredAt)),
    );
  }

  /** Dépôt de l'entreprise : stock proposable, bonus limités, réservations. */
  depot(tx: Pick<Tx, 'warehouse'>) {
    return this.ledger.mainDepot(tx);
  }

  /** Stock disponible au dépôt par article, en unité de base (physique − réservé). */
  async availableStock(tx: Pick<Tx, 'warehouse' | 'stock'>): Promise<Map<string, number>> {
    const depot = await this.depot(tx);
    const rows = await tx.stock.findMany({ where: { warehouseId: depot.id, deletedAt: null } });
    return new Map(rows.map((s) => [s.productVariantId, s.physicalQty - s.reservedQty]));
  }

  /** Quantités qui consomment le quota du vendeur ce jour-là, par article, en unité de base. */
  async consumedQuota(
    tx: Pick<Tx, 'orderLine'>,
    userId: string,
    date: string,
    bonusConsumesQuota: boolean,
    excludeOrderId?: string,
  ): Promise<Map<string, number>> {
    const lines = await tx.orderLine.findMany({
      where: {
        kind: bonusConsumesQuota ? { in: ['NORMAL', 'BONUS'] } : 'NORMAL',
        order: {
          sellerUserId: userId,
          orderDate: toDate(date),
          status: { in: [...QUOTA_STATUSES] },
          deletedAt: null,
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
      },
      select: { productVariantId: true, orderedQty: true },
    });
    const consumed = new Map<string, number>();
    for (const l of lines)
      consumed.set(l.productVariantId, (consumed.get(l.productVariantId) ?? 0) + l.orderedQty);
    return consumed;
  }

  /**
   * Panier recalculé par le serveur (BR-CAT-04 à 09, BR-QUO-03) : prix et paliers sur la quantité
   * demandée, scission au quota dans l'unité saisie, bonus sur les seules quantités confirmées.
   */
  private async build(
    tx: Tx,
    actor: AuthUser,
    input: {
      customerTypeId: string;
      date: string;
      lines: CartLineInput[];
      freeVariantChoices?: Record<string, string>;
      excludeOrderId?: string;
    },
  ) {
    const variantIds = input.lines.map((l) => l.variantId);
    if (new Set(variantIds).size !== variantIds.length)
      throw validation('Un article ne peut figurer qu’une fois dans la commande.');

    const [catalog, available, settingsRow] = await Promise.all([
      this.pricing.pricingCatalog(input.customerTypeId),
      this.availableStock(tx),
      tx.companySettings.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    const settings = companySettingsSchema.parse(settingsRow?.data ?? {});
    const context = {
      customerTypeId: input.customerTypeId,
      date: input.date,
      availableStock: available,
      freeVariantChoices: new Map(Object.entries(input.freeVariantChoices ?? {})),
    };
    const full = priceCart(catalog, input.lines, context);
    if (full.unpriced.length > 0)
      throw rule('Article non proposable à ce client (pas de prix pour son type).', {
        variantIds: full.unpriced.map((u) => u.variantId),
      });

    const quotas = await tx.quota.findMany({
      where: {
        userId: actor.userId,
        date: toDate(input.date),
        productVariantId: { in: variantIds },
        deletedAt: null,
      },
    });
    const consumed = await this.consumedQuota(
      tx,
      actor.userId,
      input.date,
      settings.rules.P03_bonusConsumesQuota,
      input.excludeOrderId,
    );
    const unitBase = (unitId: string) => catalog.units.find((u) => u.id === unitId)!.baseQty;

    const built: BuiltLine[] = [];
    for (const l of full.lines) {
      const quota = quotas.find((q) => q.productVariantId === l.variantId);
      const remaining = quota ? quota.qty - (consumed.get(l.variantId) ?? 0) : null;
      const split = splitByQuota(l.qty, unitBase(l.unitId), remaining);
      const base = {
        productId: l.productId,
        variantId: l.variantId,
        unitId: l.unitId,
        unitPrice: l.unitPrice,
        tierMinQty: l.tierMinQty,
        bonusRuleId: null,
        customerTypeId: input.customerTypeId,
      };
      if (split.normal > 0)
        built.push({
          ...base,
          kind: 'NORMAL',
          qty: split.normal,
          baseQty: split.normal * unitBase(l.unitId),
        });
      if (split.pending > 0)
        built.push({
          ...base,
          kind: 'PENDING',
          qty: split.pending,
          baseQty: split.pending * unitBase(l.unitId),
        });
    }

    // Bonus sur les quantités confirmées seulement : une ligne en attente n'est pas encore vendue
    const confirmedCart = priceCart(
      catalog,
      built
        .filter((l) => l.kind === 'NORMAL')
        .map((l) => ({ variantId: l.variantId, unitId: l.unitId, qty: l.qty })),
      context,
    );
    for (const f of confirmedCart.freeLines)
      if (f.qty > 0)
        built.push({
          kind: 'BONUS',
          productId: f.productId,
          variantId: f.variantId,
          unitId: f.unitId,
          qty: f.qty,
          baseQty: f.qty * unitBase(f.unitId),
          unitPrice: 0,
          tierMinQty: null,
          bonusRuleId: f.ruleId,
          customerTypeId: input.customerTypeId,
        });
    return { lines: built, catalog };
  }

  /**
   * Réserve le stock du dépôt pour les lignes normales et bonus (BR-CMD-04) : la partie non
   * couverte reste en rupture. Passe par le registre, qui verrouille et trace la réservation.
   */
  private async reserve(
    tx: Tx,
    actor: AuthUser,
    orderId: string,
    lines: BuiltLine[],
    occurredAt: Date,
  ) {
    const depot = await this.depot(tx);
    const ids = [...new Set(lines.filter((l) => l.kind !== 'PENDING').map((l) => l.variantId))];
    const balances = await this.ledger.balances(tx, actor.companyId, depot.id, ids);
    const available = new Map(
      ids.map((id) => [id, balances.get(id)!.physical - balances.get(id)!.reserved]),
    );
    const reserved = new Map<BuiltLine, number>();
    const moves: Move[] = [];
    for (const l of lines) {
      if (l.kind === 'PENDING') continue;
      const take = Math.max(0, Math.min(l.baseQty, available.get(l.variantId) ?? 0));
      reserved.set(l, take);
      if (take === 0) continue;
      available.set(l.variantId, (available.get(l.variantId) ?? 0) - take);
      moves.push({
        type: 'RESERVATION',
        variantId: l.variantId,
        qty: take,
        toWarehouseId: depot.id,
        source: { type: 'ORDER', id: orderId },
      });
    }
    await this.ledger.apply(tx, actor, moves, occurredAt);
    return reserved;
  }

  /** Libère le stock réservé par les lignes d'une commande. */
  private async release(tx: Tx, actor: AuthUser, orderId: string, occurredAt: Date) {
    const depot = await this.depot(tx);
    const lines = await tx.orderLine.findMany({ where: { orderId, reservedQty: { gt: 0 } } });
    await this.ledger.apply(
      tx,
      actor,
      lines.map((l) => ({
        type: 'RELEASE' as const,
        variantId: l.productVariantId,
        qty: l.reservedQty,
        fromWarehouseId: depot.id,
        source: { type: 'ORDER' as const, id: orderId },
      })),
      occurredAt,
    );
  }

  /** Identifiants des paliers appliqués, pour les retrouver sur les lignes. */
  private async tierIds(tx: Tx, lines: BuiltLine[]) {
    const tiers = await tx.priceTier.findMany({
      where: {
        deletedAt: null,
        customerTypeId: lines[0]?.customerTypeId,
        productId: { in: lines.filter((l) => l.tierMinQty !== null).map((l) => l.productId) },
      },
    });
    return (l: BuiltLine) =>
      l.tierMinQty === null
        ? null
        : (tiers.find(
            (t) =>
              t.productId === l.productId &&
              t.unitId === l.unitId &&
              t.minQty === l.tierMinQty &&
              (t.productVariantId === null || t.productVariantId === l.variantId),
          )?.id ?? null);
  }

  /** Enregistre les lignes et la réservation ; renvoie le résumé pour le téléphone. */
  private async writeLines(
    tx: Tx,
    actor: AuthUser,
    orderId: string,
    lines: BuiltLine[],
    occurredAt: Date,
  ) {
    const reserved = await this.reserve(tx, actor, orderId, lines, occurredAt);
    const tierId = await this.tierIds(tx, lines);
    await tx.orderLine.createMany({
      data: lines.map((l) => {
        const take = reserved.get(l) ?? 0;
        return {
          id: uuidv7(),
          companyId: actor.companyId,
          orderId,
          kind: l.kind,
          pendingStatus: l.kind === 'PENDING' ? ('TO_PROCESS' as const) : null,
          enteredQty: l.qty,
          orderedQty: l.baseQty,
          reservedQty: take,
          unitPrice: BigInt(l.unitPrice),
          lineAmount: BigInt(l.unitPrice * l.qty),
          isStockout: l.kind !== 'PENDING' && take < l.baseQty,
          productId: l.productId,
          productVariantId: l.variantId,
          unitId: l.unitId,
          priceTierId: tierId(l),
          bonusRuleId: l.bonusRuleId,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          occurredAt,
        };
      }),
    });
    return {
      totalAmount: lines
        .filter((l) => l.kind === 'NORMAL')
        .reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
      pendingLines: lines
        .filter((l) => l.kind === 'PENDING')
        .map((l) => ({ variantId: l.variantId, qty: l.qty })),
      stockouts: lines
        .filter((l) => l.kind !== 'PENDING' && (reserved.get(l) ?? 0) < l.baseQty)
        .map((l) => ({
          variantId: l.variantId,
          reservedQty: reserved.get(l) ?? 0,
          orderedQty: l.baseQty,
        })),
    };
  }

  private async deliveryDate(tx: Tx, date: string): Promise<string> {
    const [settings, holidays] = await Promise.all([
      tx.companySettings.findFirst({ orderBy: { version: 'desc' } }),
      tx.holiday.findMany({ where: { deletedAt: null } }),
    ]);
    return nextWorkingDay(date, {
      workingDays: companySettingsSchema.parse(settings?.data ?? {}).workingDays as WeekdayCode[],
      holidays: holidays.map((h) => dateOnly(h.date)),
    });
  }

  private async confirm(actor: AuthUser, tx: Tx, payload: ConfirmPayload, occurredAt: Date) {
    const workday = await this.workdays.openWorkday(tx, actor);
    const visit = await tx.visit.findFirst({
      where: { id: payload.visitId, userId: actor.userId, deletedAt: null },
      include: { order: true },
    });
    if (!visit || visit.status !== 'IN_PROGRESS')
      throw invalidState('Commencez la visite du client avant de prendre sa commande.');
    if (visit.order) throw invalidState('Cette visite a déjà une commande.');
    if (await tx.order.findFirst({ where: { number: payload.number } }))
      throw dup(`La commande ${payload.number} existe déjà.`);
    const customer = await this.visits.sectorCustomer(tx, actor, visit.customerId);

    const date = dateOnly(workday.date);
    const { lines } = await this.build(tx, actor, {
      customerTypeId: customer.customerTypeId,
      date,
      lines: payload.lines,
      freeVariantChoices: payload.freeVariantChoices,
    });
    const deliveryDate = await this.deliveryDate(tx, date);
    await tx.order.create({
      data: {
        id: payload.orderId,
        companyId: actor.companyId,
        number: payload.number,
        source: visit.mode === 'PHONE' ? 'PHONE' : 'PRE_SALES',
        status: 'CONFIRMED',
        orderDate: workday.date,
        deliveryDate: toDate(deliveryDate),
        confirmedAt: occurredAt,
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
    const summary = await this.writeLines(tx, actor, payload.orderId, lines, occurredAt);
    await tx.order.update({
      where: { id: payload.orderId },
      data: { totalAmount: BigInt(summary.totalAmount) },
    });
    // La commande termine la visite (BR-VIS-06)
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
        action: 'order.confirm',
        entity: 'Order',
        entityId: payload.orderId,
        after: { number: payload.number, totalAmount: summary.totalAmount, lines: lines.length },
      },
      tx,
    );
    return { orderId: payload.orderId, number: payload.number, deliveryDate, ...summary };
  }

  /** Commande du vendeur, modifiable : confirmée, journée en cours (BR-CMD-02, UC-17). */
  private async editable(tx: Tx, actor: AuthUser, orderId: string) {
    const order = await tx.order.findFirst({
      where: { id: orderId, sellerUserId: actor.userId, deletedAt: null },
      include: { workday: true },
    });
    if (!order) throw notFound('Commande introuvable.');
    if (order.status !== 'CONFIRMED' || order.workday.status !== 'IN_PROGRESS')
      throw invalidState('Cette commande ne peut plus être modifiée : la journée est clôturée.');
    return order;
  }

  private async update(actor: AuthUser, tx: Tx, payload: UpdatePayload, occurredAt: Date) {
    const order = await this.editable(tx, actor, payload.orderId);
    // Le superviseur a accepté ou refusé une ligne en attente : sa décision ne doit pas être défaite
    if (
      await tx.orderLine.findFirst({
        where: { orderId: order.id, kind: 'PENDING', pendingStatus: { not: 'TO_PROCESS' } },
      })
    )
      throw invalidState(
        'Le superviseur a déjà traité une ligne en attente de cette commande : elle ne peut plus être modifiée.',
      );
    await this.release(tx, actor, order.id, occurredAt);
    await tx.orderLine.deleteMany({ where: { orderId: order.id } });
    const { lines } = await this.build(tx, actor, {
      customerTypeId: order.customerTypeId,
      date: dateOnly(order.orderDate),
      lines: payload.lines,
      freeVariantChoices: payload.freeVariantChoices,
      excludeOrderId: order.id,
    });
    const summary = await this.writeLines(tx, actor, order.id, lines, occurredAt);
    await tx.order.update({
      where: { id: order.id },
      data: { totalAmount: BigInt(summary.totalAmount), version: { increment: 1 } },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'order.update',
        entity: 'Order',
        entityId: order.id,
        before: { totalAmount: Number(order.totalAmount) },
        after: { totalAmount: summary.totalAmount },
      },
      tx,
    );
    return { orderId: order.id, number: order.number, ...summary };
  }

  private async cancel(actor: AuthUser, tx: Tx, orderId: string, occurredAt: Date) {
    const order = await this.editable(tx, actor, orderId);
    await this.release(tx, actor, order.id, occurredAt);
    await tx.orderLine.updateMany({ where: { orderId: order.id }, data: { reservedQty: 0 } });
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: occurredAt, version: { increment: 1 } },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'order.cancel',
        entity: 'Order',
        entityId: order.id,
      },
      tx,
    );
    return { orderId: order.id };
  }

  /** Commandes au format des écrans (téléphone et Web). */
  async toDtos(where: Prisma.OrderWhereInput): Promise<OrderDto[]> {
    const orders = await this.db.order.findMany({
      where: { deletedAt: null, ...where },
      include: {
        customer: true,
        sellerUser: true,
        orderLines: { include: { product: true, productVariant: true, unit: true } },
      },
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const order = { NORMAL: 0, PENDING: 1, BONUS: 2 } as const;
    return orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      source: o.source,
      orderDate: dateOnly(o.orderDate),
      deliveryDate: o.deliveryDate ? dateOnly(o.deliveryDate) : null,
      totalAmount: Number(o.totalAmount),
      visitId: o.visitId,
      customer: { id: o.customer.id, name: o.customer.name, code: o.customer.code },
      seller: {
        id: o.sellerUser.id,
        code: o.sellerUser.code,
        name: `${o.sellerUser.firstName} ${o.sellerUser.lastName}`,
      },
      confirmedAt: o.confirmedAt?.toISOString() ?? null,
      lines: [...o.orderLines]
        .sort(
          (a, b) => order[a.kind] - order[b.kind] || a.product.name.localeCompare(b.product.name),
        )
        .map((l) => ({
          id: l.id,
          kind: l.kind,
          pendingStatus: l.pendingStatus,
          productId: l.productId,
          variantId: l.productVariantId,
          unitId: l.unitId,
          productName: l.product.name,
          variantName: l.productVariant.isDefault ? null : l.productVariant.name,
          unitName: l.unit.name,
          enteredQty: l.enteredQty,
          orderedQty: l.orderedQty,
          reservedQty: l.reservedQty,
          unitPrice: Number(l.unitPrice),
          lineAmount: Number(l.lineAmount),
          isStockout: l.isStockout,
        })),
    }));
  }

  /** Grille de prix d'un type de client (pour le catalogue de visite). */
  catalogFor(customerTypeId: string): Promise<PricingCatalog> {
    return this.pricing.pricingCatalog(customerTypeId);
  }
}
