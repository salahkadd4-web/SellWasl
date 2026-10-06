import { Inject, Injectable } from '@nestjs/common';
import { localDate, visitCounters } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type SupervisorMapDto,
  type TodayRowDto,
} from '@sellwasl/validation';
import { toDate } from '../field/field-errors';
import { PlanningService } from '../planning/planning.service';
import { fullName, localRange } from '../stock/stock-helpers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { FIELD_ROLES, SELLER_ROLES } from './reports.service';

/**
 * Suivi en temps réel (UC-57, UC-63) : tableau du jour par utilisateur de terrain et carte du
 * superviseur. Le Web les interroge toutes les 30 secondes.
 */
@Injectable()
export class LiveService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly planning: PlanningService,
  ) {}

  private async context(date?: string) {
    const [company, settingsRow] = await Promise.all([
      this.db.company.findFirstOrThrow(),
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    const settings = companySettingsSchema.parse(settingsRow?.data ?? {});
    const day = date ?? localDate(new Date(), company.timezone);
    const users = await this.db.user.findMany({
      where: { deletedAt: null, status: 'ACTIVE', role: { code: { in: [...FIELD_ROLES] } } },
      include: { role: true },
      orderBy: { code: 'asc' },
    });
    return { company, settings, day, users };
  }

  async today(): Promise<TodayRowDto[]> {
    const { settings, day, users } = await this.context();
    const ids = users.map((u) => u.id);
    const [workdays, visits, pings, syncs, routes] = await Promise.all([
      this.db.workday.findMany({
        where: { userId: { in: ids }, date: toDate(day), deletedAt: null },
      }),
      this.db.visit.findMany({
        where: { userId: { in: ids }, date: toDate(day), deletedAt: null },
      }),
      this.db.devicePing.findMany({
        where: { userId: { in: ids } },
        orderBy: { recordedAt: 'desc' },
        distinct: ['userId'],
      }),
      this.db.syncOperation.findMany({
        where: { userId: { in: ids } },
        orderBy: { receivedAt: 'desc' },
        distinct: ['userId'],
        select: { userId: true, receivedAt: true },
      }),
      this.db.deliveryRoute.findMany({
        where: { deliveryUserId: { in: ids }, deliveryDate: toDate(day), deletedAt: null },
        include: { orders: { select: { id: true } }, deliveries: { select: { id: true } } },
      }),
    ]);
    const orders = await this.db.order.groupBy({
      by: ['workdayId'],
      where: {
        workdayId: { in: workdays.map((w) => w.id) },
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        deletedAt: null,
      },
      _count: true,
      _sum: { totalAmount: true },
    });
    const onlineAfter = Date.now() - 3 * settings.positionIntervalMin * 60_000;
    const rows: TodayRowDto[] = [];
    for (const u of users) {
      const workday = workdays.find((w) => w.userId === u.id);
      const mine = visits.filter((v) => v.userId === u.id);
      let planned = 0;
      let visited = 0;
      if ((SELLER_ROLES as readonly string[]).includes(u.role.code)) {
        const plan = await this.planning.day(u.id, day);
        const counters = visitCounters(
          plan.customers.map((c) => c.id),
          mine,
        );
        planned = counters.planned;
        visited = counters.visited + counters.outOfProgram;
      } else {
        const route = routes.filter((r) => r.deliveryUserId === u.id);
        planned = route.reduce((s, r) => s + r.orders.length, 0);
        visited = route.reduce((s, r) => s + r.deliveries.length, 0);
      }
      const ping = pings.find((p) => p.userId === u.id);
      const sync = syncs.find((s) => s.userId === u.id);
      const order = workday ? orders.find((o) => o.workdayId === workday.id) : undefined;
      const lastSignal = Math.max(ping?.recordedAt.getTime() ?? 0, sync?.receivedAt.getTime() ?? 0);
      rows.push({
        user: { id: u.id, code: u.code, name: fullName(u), role: u.role.name },
        workday: workday
          ? workday.status === 'IN_PROGRESS'
            ? 'IN_PROGRESS'
            : 'CLOSED'
          : 'NOT_STARTED',
        visited,
        planned,
        outOfZone: mine.filter((v) => v.isOutOfZone).length,
        byPhone: mine.filter((v) => v.mode === 'PHONE').length,
        orders: order?._count ?? 0,
        revenue: Number(order?._sum.totalAmount ?? 0n),
        lastPosition:
          ping?.latitude != null && ping.longitude != null
            ? {
                latitude: ping.latitude,
                longitude: ping.longitude,
                at: ping.recordedAt.toISOString(),
              }
            : null,
        lastSyncAt: sync?.receivedAt.toISOString() ?? null,
        battery: ping?.batteryLevel ?? null,
        pendingOps: ping?.pendingOps ?? 0,
        online: lastSignal > onlineAfter,
      });
    }
    return rows;
  }

  async map(date?: string): Promise<SupervisorMapDto> {
    const { company, day, users } = await this.context(date);
    const sellers = users.filter((u) => (SELLER_ROLES as readonly string[]).includes(u.role.code));
    const [visits, pings] = await Promise.all([
      this.db.visit.findMany({
        where: { date: toDate(day), status: 'COMPLETED', deletedAt: null },
        select: { userId: true, customerId: true },
      }),
      this.db.devicePing.findMany({
        where: {
          userId: { in: users.map((u) => u.id) },
          recordedAt: localRange(day, day, company.timezone),
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: { recordedAt: 'desc' },
        distinct: ['userId'],
      }),
    ]);
    const partIds = new Set<string>();
    const customers: SupervisorMapDto['customers'] = [];
    for (const u of sellers) {
      const plan = await this.planning.day(u.id, day);
      if (plan.part) partIds.add(plan.part.id);
      for (const c of plan.customers)
        if (c.latitude != null && c.longitude != null)
          customers.push({
            id: c.id,
            name: c.name,
            latitude: c.latitude,
            longitude: c.longitude,
            visited: visits.some((v) => v.userId === u.id && v.customerId === c.id),
            userId: u.id,
          });
    }
    const parts = await this.db.territoryPart.findMany({
      where: { id: { in: [...partIds] } },
      include: { territory: true },
    });
    return {
      date: day,
      parts: parts.map((p) => ({
        id: p.id,
        name: p.name,
        territory: `${p.territory.code} · ${p.territory.name}`,
        geojson: p.geojson,
      })),
      customers,
      positions: pings.map((p) => {
        const u = users.find((x) => x.id === p.userId)!;
        return {
          userId: p.userId,
          name: fullName(u),
          latitude: p.latitude!,
          longitude: p.longitude!,
          at: p.recordedAt.toISOString(),
        };
      }),
    };
  }
}
