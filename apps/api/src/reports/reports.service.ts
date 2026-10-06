import { Inject, Injectable } from '@nestjs/common';
import { rate } from '@sellwasl/business-rules';
import type {
  CommercialReportDto,
  DashboardDto,
  DeliveryReportDto,
  KeyLabel,
  LostSalesReportDto,
  PresalesReportDto,
  RateDto,
  ReportsQuery,
  UserSheetDto,
} from '@sellwasl/validation';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { PlanningService } from '../planning/planning.service';
import { ReturnsService } from '../returns/returns.service';
import { articleName, fullName } from '../stock/stock-helpers';
import { StockQueryService } from '../stock/stock-query.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

export const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'] as const;
export const FIELD_ROLES = [...SELLER_ROLES, 'LIVREUR'] as const;
const WEEKS = { WEEKLY: 1, BIWEEKLY: 2, EVERY_4_WEEKS: 4 } as const;
const DAY_MS = 86_400_000;

type Period = { from: string; to: string };
const between = (q: Period) => ({ gte: toDate(q.from), lte: toDate(q.to) });
/** Conversion : visites avec commande ou vente ÷ visites réalisées (une visite suffit). */
const conversion = (withOrder: number, done: number): RateDto => rate(withOrder, done, 1);

/** Agrège des lignes par clé, en gardant le libellé. */
function groupBy<T, R extends object>(
  rows: T[],
  key: (r: T) => string | null,
  label: (r: T) => string,
  init: () => R,
  add: (acc: R, r: T) => void,
): (KeyLabel & R)[] {
  const map = new Map<string | null, KeyLabel & R>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, { key: k, label: label(r), ...init() });
    add(map.get(k)!, r);
  }
  return [...map.values()];
}

/**
 * Dashboard de l'entreprise, fiche d'un utilisateur et rapports (phase 21, module ANALYTICS) :
 * calcul à la demande sur les commandes, visites, journées et livraisons de la période.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly planning: PlanningService,
    private readonly stock: StockQueryService,
    private readonly returns: ReturnsService,
  ) {}

  /** Filtre des commandes d'une période (hors brouillons et annulées). */
  private orderWhere(q: Partial<ReportsQuery> & Period): Prisma.OrderWhereInput {
    return {
      deletedAt: null,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
      orderDate: between(q),
      ...(q.userId && { sellerUserId: q.userId }),
      ...(q.customerId && { customerId: q.customerId }),
      ...(q.productId && { orderLines: { some: { productId: q.productId } } }),
      ...((q.territoryId || q.partId) && {
        customer: {
          ...(q.territoryId && { territoryId: q.territoryId }),
          ...(q.partId && { partId: q.partId }),
        },
      }),
    };
  }

  private visitWhere(q: Partial<ReportsQuery> & Period): Prisma.VisitWhereInput {
    return {
      deletedAt: null,
      date: between(q),
      ...(q.userId && { userId: q.userId }),
      ...(q.customerId && { customerId: q.customerId }),
      ...((q.territoryId || q.partId) && {
        customer: {
          ...(q.territoryId && { territoryId: q.territoryId }),
          ...(q.partId && { partId: q.partId }),
        },
      }),
    };
  }

  /**
   * Visites planifiées et non faites : journées clôturées par leurs visites du programme (faites
   * ou manquées), journées en cours par le planning du jour.
   */
  private async plannedVisits(q: Partial<ReportsQuery> & Period) {
    const scheduled = await this.db.visit.groupBy({
      by: ['status'],
      where: {
        ...this.visitWhere(q),
        isScheduled: true,
        status: { in: ['COMPLETED', 'MISSED'] },
        workday: { status: { not: 'IN_PROGRESS' } },
      },
      _count: true,
    });
    let planned = scheduled.reduce((sum, s) => sum + s._count, 0);
    let notVisited = scheduled.find((s) => s.status === 'MISSED')?._count ?? 0;
    const open = await this.db.workday.findMany({
      where: {
        deletedAt: null,
        status: 'IN_PROGRESS',
        date: between(q),
        ...(q.userId && { userId: q.userId }),
        user: { role: { code: { in: [...SELLER_ROLES] } } },
      },
    });
    for (const w of open) {
      const day = await this.planning.day(w.userId, dateOnly(w.date));
      if (q.territoryId && day.territory?.id !== q.territoryId) continue;
      const done = await this.db.visit.count({
        where: { workdayId: w.id, isScheduled: true, status: 'COMPLETED', deletedAt: null },
      });
      planned += day.customers.length;
      notVisited += Math.max(0, day.customers.length - done);
    }
    return { planned, notVisited };
  }

  /** Clients actifs sans visite depuis plus que leur fréquence, à la fin de la période. */
  private async lateCustomers(q: Period & { territoryId?: string }): Promise<number> {
    const end = toDate(q.to);
    const [customers, last] = await Promise.all([
      this.db.customer.findMany({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          isClosedPermanently: false,
          partId: { not: null },
          ...(q.territoryId && { territoryId: q.territoryId }),
        },
        select: { id: true, frequency: true },
      }),
      this.db.visit.groupBy({
        by: ['customerId'],
        where: { deletedAt: null, status: 'COMPLETED', date: { lte: end } },
        _max: { date: true },
      }),
    ]);
    return customers.filter((c) => {
      const seen = last.find((l) => l.customerId === c.id)?._max.date;
      return !seen || end.getTime() - seen.getTime() > WEEKS[c.frequency] * 7 * DAY_MS;
    }).length;
  }

  async dashboard(actor: AuthUser, q: Period & { territoryId?: string }): Promise<DashboardDto> {
    const orderWhere = this.orderWhere(q);
    const visitWhere = this.visitWhere(q);
    const territory = q.territoryId ? { customer: { territoryId: q.territoryId } } : {};
    const [
      orders,
      done,
      withOrder,
      planned,
      late,
      workdays,
      preparing,
      inDelivery,
      failures,
      alerts,
      stockouts,
    ] = await Promise.all([
      this.db.order.aggregate({ where: orderWhere, _sum: { totalAmount: true }, _count: true }),
      this.db.visit.count({ where: { ...visitWhere, status: 'COMPLETED' } }),
      this.db.visit.count({
        where: { ...visitWhere, status: 'COMPLETED', outcome: { in: ['ORDER', 'SALE'] } },
      }),
      this.plannedVisits(q),
      this.lateCustomers(q),
      this.db.workday.findMany({
        where: { deletedAt: null, date: between(q), startedAt: { not: null } },
        include: { user: { include: { role: true } } },
      }),
      this.db.order.count({
        where: { deletedAt: null, status: { in: ['PREPARING', 'READY'] }, ...territory },
      }),
      this.db.order.count({
        where: { deletedAt: null, status: 'OUT_FOR_DELIVERY', ...territory },
      }),
      this.db.delivery.count({
        where: {
          deletedAt: null,
          result: 'FAILED',
          workday: { date: between(q) },
          ...(q.territoryId && { order: territory }),
        },
      }),
      this.stock.alerts(),
      this.db.orderLine.count({ where: { isStockout: true, order: orderWhere } }),
    ]);
    const activeOf = (roles: readonly string[]) =>
      new Set(workdays.filter((w) => roles.includes(w.user.role.code)).map((w) => w.userId)).size;
    const dto: DashboardDto = {
      from: q.from,
      to: q.to,
      revenue: Number(orders._sum.totalAmount ?? 0n),
      orders: orders._count,
      visits: { planned: planned.planned, done },
      notVisited: planned.notVisited,
      lateCustomers: late,
      conversion: conversion(withOrder, done),
      activeSellers: activeOf(SELLER_ROLES),
      activeDrivers: activeOf(['LIVREUR']),
      ordersPreparing: preparing,
      ordersInDelivery: inDelivery,
      deliveryFailures: failures,
      lowStock: alerts.length,
      stockouts,
    };
    if (actor.modules.includes('RETURNS_ANALYSIS') && actor.permissions.has('returns.read'))
      dto.returns = await this.returns.summary({
        from: q.from,
        to: q.to,
        territoryId: q.territoryId,
      });
    return dto;
  }

  async userSheet(actor: AuthUser, userId: string, q: Period): Promise<UserSheetDto> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { role: true },
    });
    if (!user) throw notFound('Utilisateur introuvable.');
    const visitWhere = this.visitWhere({ ...q, userId });
    const [workdays, done, withOrder, orders, deliveries, collected] = await Promise.all([
      this.db.workday.count({ where: { userId, deletedAt: null, date: between(q) } }),
      this.db.visit.count({ where: { ...visitWhere, status: 'COMPLETED' } }),
      this.db.visit.count({
        where: { ...visitWhere, status: 'COMPLETED', outcome: { in: ['ORDER', 'SALE'] } },
      }),
      this.db.order.aggregate({
        where: this.orderWhere({ ...q, userId }),
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.db.delivery.groupBy({
        by: ['result'],
        where: { userId, deletedAt: null, workday: { date: between(q) } },
        _count: true,
      }),
      this.db.payment.aggregate({
        where: { userId, deletedAt: null, workday: { date: between(q) } },
        _sum: { cashAmount: true },
      }),
    ]);
    const count = (r: string) => deliveries.find((d) => d.result === r)?._count ?? 0;
    const dto: UserSheetDto = {
      user: { id: user.id, code: user.code, name: fullName(user), role: user.role.name },
      from: q.from,
      to: q.to,
      workdays,
      visits: done,
      orders: orders._count,
      revenue: Number(orders._sum.totalAmount ?? 0n),
      conversion: conversion(withOrder, done),
      deliveries: {
        delivered: count('DELIVERED'),
        partial: count('PARTIAL'),
        failed: count('FAILED'),
      },
      collected: Number(collected._sum.cashAmount ?? 0n),
    };
    if (actor.modules.includes('RETURNS_ANALYSIS') && actor.permissions.has('returns.read'))
      dto.returns = await this.returns.summary({ from: q.from, to: q.to, userId });
    return dto;
  }

  async commercial(q: ReportsQuery): Promise<CommercialReportDto> {
    const orders = await this.db.order.findMany({
      where: this.orderWhere(q),
      include: {
        customer: true,
        orderLines: {
          where: { kind: 'NORMAL', ...(q.productId && { productId: q.productId }) },
          include: { productVariant: { include: { product: true } } },
        },
      },
      orderBy: { orderDate: 'asc' },
    });
    const byDay = groupBy(
      orders,
      (o) => dateOnly(o.orderDate),
      (o) => dateOnly(o.orderDate),
      () => ({ orders: 0, revenue: 0 }),
      (acc, o) => {
        acc.orders += 1;
        acc.revenue += Number(o.totalAmount);
      },
    ).map(({ key, orders: n, revenue }) => ({ date: key!, orders: n, revenue }));
    const lines = orders.flatMap((o) => o.orderLines);
    const byProduct = groupBy(
      lines,
      (l) => l.productId,
      (l) => l.productVariant.product.name,
      () => ({ qty: 0, revenue: 0 }),
      (acc, l) => {
        acc.qty += l.deliveredQty ?? l.orderedQty;
        acc.revenue += Number(l.lineAmount);
      },
    ).sort((a, b) => b.revenue - a.revenue);
    const byCustomer = groupBy(
      orders,
      (o) => o.customerId,
      (o) => o.customer.name,
      () => ({ orders: 0, revenue: 0 }),
      (acc, o) => {
        acc.orders += 1;
        acc.revenue += Number(o.totalAmount);
      },
    ).sort((a, b) => b.revenue - a.revenue);
    return { byDay, byProduct, byCustomer };
  }

  async presales(q: ReportsQuery): Promise<PresalesReportDto> {
    const [visits, orders] = await Promise.all([
      this.db.visit.findMany({
        where: { ...this.visitWhere(q), status: 'COMPLETED' },
        include: { user: true, customer: { include: { territory: true } } },
      }),
      this.db.order.findMany({
        where: this.orderWhere(q),
        include: { sellerUser: true, customer: { include: { territory: true } } },
      }),
    ]);
    type Acc = { visits: number; withOrder: number; orders: number; revenue: number };
    const init = (): Acc => ({ visits: 0, withOrder: 0, orders: 0, revenue: 0 });
    const build = (
      key: (x: {
        userId?: string;
        sellerUserId?: string;
        customer: { territoryId: string | null };
      }) => string | null,
      label: (v: (typeof visits)[number] | (typeof orders)[number]) => string,
    ) => {
      const map = new Map<string | null, KeyLabel & Acc>();
      const at = (k: string | null, l: string) => {
        if (!map.has(k)) map.set(k, { key: k, label: l, ...init() });
        return map.get(k)!;
      };
      for (const v of visits) {
        const acc = at(key(v), label(v));
        acc.visits += 1;
        if (v.outcome === 'ORDER' || v.outcome === 'SALE') acc.withOrder += 1;
      }
      for (const o of orders) {
        const acc = at(key(o), label(o));
        acc.orders += 1;
        acc.revenue += Number(o.totalAmount);
      }
      return [...map.values()]
        .map(({ withOrder, ...r }) => ({ ...r, conversion: conversion(withOrder, r.visits) }))
        .sort((a, b) => b.revenue - a.revenue);
    };
    const territoryLabel = (x: {
      customer: { territory: { code: string; name: string } | null };
    }) =>
      x.customer.territory
        ? `${x.customer.territory.code} · ${x.customer.territory.name}`
        : 'Sans secteur';
    return {
      bySeller: build(
        (x) => x.userId ?? x.sellerUserId ?? null,
        (x) => {
          const u = 'user' in x ? x.user : x.sellerUser;
          return `${fullName(u)} (${u.code})`;
        },
      ),
      byTerritory: build((x) => x.customer.territoryId, territoryLabel),
    };
  }

  async delivery(q: ReportsQuery): Promise<DeliveryReportDto> {
    const deliveries = await this.db.delivery.findMany({
      where: {
        deletedAt: null,
        workday: { date: between(q) },
        ...((q.driverId ?? q.userId) && { userId: q.driverId ?? q.userId }),
        ...((q.customerId || q.territoryId || q.partId) && {
          order: {
            ...(q.customerId && { customerId: q.customerId }),
            ...((q.territoryId || q.partId) && {
              customer: {
                ...(q.territoryId && { territoryId: q.territoryId }),
                ...(q.partId && { partId: q.partId }),
              },
            }),
          },
        }),
      },
      include: { user: true, order: true, workday: true, reason: true },
    });
    const byDriver = groupBy(
      deliveries,
      (d) => d.userId,
      (d) => `${fullName(d.user)} (${d.user.code})`,
      () => ({ deliveries: 0, delivered: 0, partial: 0, failed: 0, delays: [] as number[] }),
      (acc, d) => {
        acc.deliveries += 1;
        if (d.result === 'DELIVERED') acc.delivered += 1;
        else if (d.result === 'PARTIAL') acc.partial += 1;
        else acc.failed += 1;
        if (d.result !== 'FAILED')
          acc.delays.push((d.workday.date.getTime() - d.order.orderDate.getTime()) / DAY_MS);
      },
    ).map(({ delays, ...r }) => ({
      ...r,
      averageDelayDays: delays.length
        ? Math.round((delays.reduce((s, x) => s + x, 0) / delays.length) * 10) / 10
        : null,
    }));
    const failuresByReason = groupBy(
      deliveries.filter((d) => d.result === 'FAILED'),
      (d) => d.reasonId,
      (d) => d.reason?.label ?? 'Sans motif',
      () => ({ count: 0 }),
      (acc) => {
        acc.count += 1;
      },
    ).sort((a, b) => b.count - a.count);
    return { byDriver, failuresByReason };
  }

  async lostSales(q: ReportsQuery): Promise<LostSalesReportDto> {
    const rows = await this.db.lostDemand.findMany({
      where: {
        deletedAt: null,
        date: between(q),
        ...(q.userId && { userId: q.userId }),
        ...(q.customerId && { customerId: q.customerId }),
        ...(q.productId && { productVariant: { productId: q.productId } }),
        ...(q.territoryId && { customer: { territoryId: q.territoryId } }),
      },
      include: { user: true, customer: true, productVariant: { include: { product: true } } },
    });
    const init = () => ({ lostSales: 0, lostDemand: 0 });
    const add = (acc: { lostSales: number; lostDemand: number }, r: (typeof rows)[number]) => {
      if (r.kind === 'LOST_SALE') acc.lostSales += r.qty;
      else acc.lostDemand += r.qty;
    };
    const total = (r: { lostSales: number; lostDemand: number }) => r.lostSales + r.lostDemand;
    return {
      byProduct: groupBy(
        rows,
        (r) => r.productVariantId,
        (r) => articleName(r.productVariant),
        init,
        add,
      ).sort((a, b) => total(b) - total(a)),
      byCustomer: groupBy(
        rows,
        (r) => r.customerId,
        (r) => r.customer.name,
        init,
        add,
      ).sort((a, b) => total(b) - total(a)),
      bySeller: groupBy(
        rows,
        (r) => r.userId,
        (r) => `${fullName(r.user)} (${r.user.code})`,
        init,
        add,
      ).sort((a, b) => total(b) - total(a)),
    };
  }
}
