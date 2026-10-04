import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { localDate, missedCustomers, visitCounters } from '@sellwasl/business-rules';
import {
  companySettingsSchema,
  type TodayResponse,
  type TodayVisit,
  workdayClosePayload,
  workdayStartPayload,
} from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma, Visit } from '../generated/prisma/client';
import { PlanningService } from '../planning/planning.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { dateOnly, frDate, invalidState, rule, toDate } from './field-errors';

/** Au-delà d'une heure d'écart entre le téléphone et le serveur, l'horloge est signalée (BR-JOU-11). */
const CLOCK_SKEW_MS = 60 * 60 * 1000;

export function toTodayVisit(v: Visit): TodayVisit {
  return {
    id: v.id,
    customerId: v.customerId,
    status: v.status,
    mode: v.mode,
    isScheduled: v.isScheduled,
    isOutOfZone: v.isOutOfZone,
    distanceM: v.distanceM,
    startedAt: v.startedAt?.toISOString() ?? null,
    endedAt: v.endedAt?.toISOString() ?? null,
  };
}

/**
 * Journée de travail du terrain (BR-JOU, UC-03, UC-05) : démarrage et clôture reçus par la
 * synchronisation, et vue « aujourd'hui » du vendeur (UC-02).
 */
@Injectable()
export class WorkdayService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly planning: PlanningService,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('workday.start', 'workdays.own', workdayStartPayload, (ctx) =>
      this.start(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('workday.close', 'workdays.own', workdayClosePayload, (ctx) =>
      this.close(ctx.actor, ctx.tx, ctx.payload.workdayId, new Date(ctx.op.occurredAt)),
    );
  }

  private async settings() {
    const row = await this.db.companySettings.findFirst({ orderBy: { version: 'desc' } });
    return { version: row?.version ?? 1, data: companySettingsSchema.parse(row?.data ?? {}) };
  }

  /** Paramètres utiles au terrain (distance hors zone, règles P-01 et P-02). */
  async fieldRules() {
    return (await this.settings()).data;
  }

  /** Journée en cours de l'utilisateur : obligatoire pour visiter ou encaisser (BR-JOU-05). */
  async openWorkday(tx: Prisma.TransactionClient, actor: AuthUser) {
    const workday = await tx.workday.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (!workday) throw invalidState("Démarrez votre journée d'abord.");
    return workday;
  }

  private async start(
    actor: AuthUser,
    tx: Prisma.TransactionClient,
    payload: { workdayId: string; date: string },
    occurredAt: Date,
  ) {
    const { workdayId, date } = payload;
    const [day, settings] = await Promise.all([
      this.planning.day(actor.userId, date),
      this.settings(),
    ]);
    if (day.status !== 'WORKING' && !settings.data.rules.P01_workOnNonWorkingDays)
      throw rule("L'entreprise n'autorise pas le travail les jours non travaillés ou fériés.", {
        rule: 'BR-JOU-03',
      });

    const existing = await tx.workday.findFirst({
      where: { userId: actor.userId, date: toDate(date), deletedAt: null },
    });
    if (existing)
      throw invalidState(
        existing.status === 'CLOSED'
          ? `Votre journée du ${frDate(date)} est déjà clôturée.`
          : `Votre journée du ${frDate(date)} est déjà démarrée.`,
      );
    const open = await tx.workday.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (open)
      throw invalidState(`Clôturez d'abord votre journée du ${frDate(dateOnly(open.date))}.`);

    await tx.workday.create({
      data: {
        id: workdayId,
        companyId: actor.companyId,
        date: toDate(date),
        status: 'IN_PROGRESS',
        startedAt: occurredAt,
        settingsVersion: settings.version,
        userId: actor.userId,
        deviceId: actor.deviceId,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    const base = {
      companyId: actor.companyId,
      actorUserId: actor.userId,
      deviceId: actor.deviceId,
      entity: 'Workday',
      entityId: workdayId,
    };
    await this.audit.write({ ...base, action: 'workday.start', after: { date } }, tx);
    const skew = Date.now() - occurredAt.getTime();
    if (Math.abs(skew) > CLOCK_SKEW_MS)
      await this.audit.write(
        {
          ...base,
          action: 'workday.clock_skew',
          after: { skewMinutes: Math.round(skew / 60_000) },
        },
        tx,
      );
    return { workdayId };
  }

  private async close(
    actor: AuthUser,
    tx: Prisma.TransactionClient,
    workdayId: string,
    occurredAt: Date,
  ) {
    const workday = await tx.workday.findFirst({
      where: { id: workdayId, userId: actor.userId, deletedAt: null },
    });
    if (!workday) throw notFound('Journée introuvable.');
    if (workday.status !== 'IN_PROGRESS') throw invalidState('Cette journée est déjà clôturée.');
    const current = await tx.visit.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (current) throw invalidState("Terminez d'abord la visite en cours.");

    // Clients du jour non visités : visite manquée, sans report (BR-PLA-06)
    const date = dateOnly(workday.date);
    const day = await this.planning.day(actor.userId, date);
    const done = await tx.visit.findMany({
      where: { workdayId, status: 'COMPLETED', deletedAt: null },
      select: { customerId: true },
    });
    const missed = missedCustomers(
      day.customers.map((c) => ({ customerId: c.id, reason: c.reason })),
      done.map((v) => v.customerId),
    );
    if (missed.length > 0)
      await tx.visit.createMany({
        data: missed.map((customerId) => ({
          id: uuidv7(),
          companyId: actor.companyId,
          date: workday.date,
          status: 'MISSED' as const,
          isScheduled: true,
          workdayId,
          userId: actor.userId,
          customerId,
          createdByUserId: actor.userId,
          createdByDeviceId: actor.deviceId,
          occurredAt,
        })),
      });

    // Les commandes passeront LOCKED avec la phase 16 (BR-JOU-07)
    await tx.workday.update({
      where: { id: workdayId },
      data: { status: 'CLOSED', closedAt: occurredAt, version: { increment: 1 } },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'workday.close',
        entity: 'Workday',
        entityId: workdayId,
        after: { missed: missed.length },
      },
      tx,
    );
    return { workdayId, missed: missed.length };
  }

  /** Journée du vendeur connecté à la date du téléphone (UC-02, UC-10). */
  async today(actor: AuthUser, requestedDate?: string): Promise<TodayResponse> {
    const company = await this.db.company.findFirstOrThrow();
    const date = requestedDate ?? localDate(new Date(), company.timezone);
    const [day, settings, workday, visits, currentVisit, user, staleWorkday, device] =
      await Promise.all([
        this.planning.day(actor.userId, date),
        this.settings(),
        this.db.workday.findFirst({
          where: { userId: actor.userId, date: toDate(date), deletedAt: null },
        }),
        this.db.visit.findMany({
          where: { userId: actor.userId, date: toDate(date), deletedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        this.db.visit.findFirst({
          where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
        }),
        this.db.user.findFirstOrThrow({ where: { id: actor.userId } }),
        this.db.workday.findFirst({
          where: {
            userId: actor.userId,
            status: 'IN_PROGRESS',
            date: { not: toDate(date) },
            deletedAt: null,
          },
        }),
        actor.deviceId ? this.db.device.findFirst({ where: { id: actor.deviceId } }) : null,
      ]);
    const collected = workday
      ? await this.db.payment.aggregate({
          where: { workdayId: workday.id, deletedAt: null },
          _sum: { cashAmount: true },
        })
      : null;
    return {
      date,
      workday: workday && {
        id: workday.id,
        status: workday.status,
        startedAt: workday.startedAt?.toISOString() ?? null,
        closedAt: workday.closedAt?.toISOString() ?? null,
      },
      openWorkday: staleWorkday && { id: staleWorkday.id, date: dateOnly(staleWorkday.date) },
      day,
      visits: visits.map(toTodayVisit),
      counters: {
        ...visitCounters(
          day.customers.map((c) => c.id),
          visits,
        ),
        collectedAmount: Number(collected?._sum.cashAmount ?? 0n),
      },
      currentVisit: currentVisit && toTodayVisit(currentVisit),
      rules: {
        outOfZoneDistanceM: settings.data.outOfZoneDistanceM,
        P01_workOnNonWorkingDays: settings.data.rules.P01_workOnNonWorkingDays,
        P02_outOfProgramVisits: settings.data.rules.P02_outOfProgramVisits,
      },
      seller: { code: user.code, series: device?.series ?? null, roleCode: actor.roleCode },
    };
  }
}
