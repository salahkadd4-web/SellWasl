import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { addDaysTo } from '@sellwasl/business-rules';
import type {
  OfflineDepotStock,
  OfflineOrder,
  OfflinePayment,
  OfflineQuota,
  OfflineWorkday,
} from '@sellwasl/validation';
import type { AuthUser } from '../../common/auth-context';
import { customerInclude, toCustomerDto } from '../../customers/customers.service';
import { dateOnly, toDate } from '../../field/field-errors';
import { ObjectivesService } from '../../field/objectives.service';
import { OrderService } from '../../field/order.service';
import { toTodayVisit } from '../../field/workday.service';
import type { Prisma } from '../../generated/prisma/client';
import { PlanningService } from '../../planning/planning.service';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { type KindContext, type KindRow, SyncKinds } from '../sync-kinds';

const ALL = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'] as const;
const SELLERS = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'] as const;
/** Historique gardé sur le téléphone (spec phase 23, Global Constraints du plan). */
const HISTORY_DAYS = 7;

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Sortes du terrain : planning, clients, quotas, objectifs, journées, visites, commandes. */
@Injectable()
export class FieldKinds implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly kinds: SyncKinds,
    private readonly planning: PlanningService,
    private readonly objectives: ObjectivesService,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      kind: 'planningDay',
      roles: SELLERS,
      mode: 'set',
      sources: [
        'customer',
        'territory',
        'territoryPart',
        'partSchedule',
        'holiday',
        'customerReschedule',
        'visit',
      ],
      load: async ({ actor, date }) =>
        Promise.all(
          [date, addDaysTo(date, 1)].map(async (d) => ({
            id: d,
            data: await this.planning.day(actor.userId, d),
          })),
        ),
    });

    this.kinds.register({
      kind: 'customer',
      roles: ALL,
      mode: 'rows',
      sources: ['customer'],
      full: ['customerType', 'territory', 'territoryPart'],
      load: (ctx) => this.customers(ctx),
    });

    this.kinds.register({
      kind: 'quota',
      roles: SELLERS,
      mode: 'set',
      sources: ['quota'],
      load: async ({ actor, date }) => {
        const rows = await this.db.quota.findMany({
          where: {
            userId: actor.userId,
            date: { gte: toDate(addDaysTo(date, -1)), lte: toDate(addDaysTo(date, 7)) },
            deletedAt: null,
          },
        });
        return rows.map((q) => {
          const data: OfflineQuota = {
            id: q.id,
            date: dateOnly(q.date),
            variantId: q.productVariantId,
            qty: q.qty,
          };
          return { id: q.id, data };
        });
      },
    });

    this.kinds.register({
      kind: 'objective',
      roles: SELLERS,
      mode: 'set',
      sources: ['objective', 'order', 'orderLine'],
      load: async ({ actor, date }) =>
        (await this.objectives.mine(actor, date.slice(0, 7))).map((o) => ({
          id: `${o.range.id}:${o.month}`,
          data: o,
        })),
    });

    this.kinds.register({
      kind: 'workday',
      roles: ALL,
      mode: 'set',
      sources: ['workday'],
      load: async ({ actor, date }) => {
        const rows = await this.db.workday.findMany({
          where: {
            userId: actor.userId,
            deletedAt: null,
            // Une journée restée ouverte d'un autre jour reste visible, pour la clôturer
            OR: [
              { date: { gte: toDate(addDaysTo(date, -HISTORY_DAYS)) } },
              { status: 'IN_PROGRESS' },
            ],
          },
        });
        return rows.map((w) => {
          const data: OfflineWorkday = {
            id: w.id,
            date: dateOnly(w.date),
            status: w.status,
            startedAt: iso(w.startedAt),
            closedAt: iso(w.closedAt),
          };
          return { id: w.id, data };
        });
      },
    });

    this.kinds.register({
      kind: 'visit',
      roles: SELLERS,
      mode: 'set',
      sources: ['visit'],
      load: async ({ actor, date }) => {
        const rows = await this.db.visit.findMany({
          where: {
            userId: actor.userId,
            deletedAt: null,
            OR: [
              { date: { gte: toDate(addDaysTo(date, -HISTORY_DAYS)) } },
              { status: 'IN_PROGRESS' },
            ],
          },
        });
        return rows.map((v) => ({
          id: v.id,
          data: { ...toTodayVisit(v), date: dateOnly(v.date) },
        }));
      },
    });

    this.kinds.register({
      kind: 'order',
      roles: SELLERS,
      mode: 'rows',
      sources: ['order', 'orderLine'],
      full: ['product', 'productVariant', 'productUnit'],
      load: (ctx) => this.ownOrders(ctx),
    });

    this.kinds.register({
      kind: 'payment',
      roles: ALL,
      mode: 'set',
      sources: ['payment'],
      load: async ({ actor, date }) => {
        const rows = await this.db.payment.findMany({
          where: {
            userId: actor.userId,
            deletedAt: null,
            workday: { date: { gte: toDate(addDaysTo(date, -HISTORY_DAYS)) } },
          },
        });
        return rows.map((p) => {
          const data: OfflinePayment = {
            id: p.id,
            number: p.number,
            kind: p.kind,
            at: (p.occurredAt ?? p.createdAt).toISOString(),
            workdayId: p.workdayId,
            customerId: p.customerId,
            orderId: p.orderId,
            dueAmount: Number(p.dueAmount),
            cashAmount: Number(p.cashAmount),
            creditAmount: Number(p.creditAmount),
          };
          return { id: p.id, data };
        });
      },
    });

    // Prévente : disponible au dépôt (physique − réservé), une indication ; le serveur tranche
    this.kinds.register({
      kind: 'depotStock',
      roles: ['PRE_VENDEUR'],
      mode: 'set',
      sources: ['stock'],
      load: async () => {
        const tx = this.db as unknown as Prisma.TransactionClient;
        const available = await this.orders.availableStock(tx);
        return [...available].map(([variantId, qty]) => {
          const data: OfflineDepotStock = { variantId, available: qty };
          return { id: variantId, data };
        });
      },
    });
  }

  /** Secteurs servis : ceux du vendeur, ou ceux que livre le livreur. */
  private async territoryIds(actor: AuthUser): Promise<string[]> {
    const rows = await this.db.territory.findMany({
      where: {
        deletedAt: null,
        ...(actor.roleCode === 'LIVREUR'
          ? { deliveryUserId: actor.userId }
          : { sellerUserId: actor.userId }),
      },
      select: { id: true },
    });
    return rows.map((t) => t.id);
  }

  /** Clients du périmètre ; ceux qui en sortent (secteur, statut, suppression) partent supprimés. */
  private async customers({ actor, cursor, full }: KindContext): Promise<KindRow[]> {
    const territories = await this.territoryIds(actor);
    const inScope = {
      deletedAt: null,
      status: 'ACTIVE',
      territoryId: { in: territories },
    } as const;
    const rows = await this.db.customer.findMany({
      where: full ? inScope : { changeXid: { gte: cursor } },
      include: customerInclude,
    });
    return rows.map((c) =>
      !c.deletedAt && c.status === 'ACTIVE' && c.territoryId && territories.includes(c.territoryId)
        ? { id: c.id, data: toCustomerDto(c) }
        : { id: c.id, data: null, deleted: true },
    );
  }

  /** Commandes et ventes du vendeur des 7 derniers jours, avec leurs lignes. */
  private async ownOrders({ actor, cursor, date, full }: KindContext): Promise<KindRow[]> {
    const own: Prisma.OrderWhereInput = {
      sellerUserId: actor.userId,
      orderDate: { gte: toDate(addDaysTo(date, -HISTORY_DAYS)) },
    };
    const changed: Prisma.OrderWhereInput = full
      ? own
      : {
          ...own,
          OR: [
            { changeXid: { gte: cursor } },
            { orderLines: { some: { changeXid: { gte: cursor } } } },
          ],
        };
    const ids = await this.db.order.findMany({
      where: changed,
      select: { id: true, deletedAt: true, workdayId: true, customerTypeId: true },
    });
    const live = ids.filter((o) => !o.deletedAt);
    const dtos = live.length ? await this.orders.toDtos({ id: { in: live.map((o) => o.id) } }) : [];
    const extra = new Map(live.map((o) => [o.id, o]));
    return [
      ...dtos.map((o) => {
        const data: OfflineOrder = {
          ...o,
          workdayId: extra.get(o.id)!.workdayId,
          customerTypeId: extra.get(o.id)!.customerTypeId,
        };
        return { id: o.id, data };
      }),
      ...ids.filter((o) => o.deletedAt).map((o) => ({ id: o.id, data: null, deleted: true })),
    ];
  }
}
