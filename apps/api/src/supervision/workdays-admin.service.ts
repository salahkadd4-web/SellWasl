import { Inject, Injectable } from '@nestjs/common';
import type { WorkdayDto } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, invalidState, toDate } from '../field/field-errors';
import { WorkdayService } from '../field/workday.service';
import type { Prisma } from '../generated/prisma/client';
import { PlanningService } from '../planning/planning.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const FIELD_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'] as const;
const SELLER_ROLES: readonly string[] = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];
/** Une commande dans l'un de ces statuts empêche de rouvrir la journée (BR-JOU-08). */
const PREPARED = [
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'FAILED',
] as const;

/** Journées du terrain vues par le superviseur (UC-57, UC-58, UC-64). */
@Injectable()
export class WorkdaysAdminService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly workdays: WorkdayService,
    private readonly planning: PlanningService,
    private readonly audit: AuditService,
  ) {}

  /** Une ligne par utilisateur terrain actif, qu'il ait démarré sa journée ou non. */
  async list(date: string): Promise<WorkdayDto[]> {
    const day = toDate(date);
    const [users, workdays] = await Promise.all([
      this.db.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE', role: { code: { in: [...FIELD_ROLES] } } },
        include: { role: true },
        orderBy: { code: 'asc' },
      }),
      this.db.workday.findMany({ where: { date: day, deletedAt: null } }),
    ]);
    const ids = workdays.map((w) => w.id);
    const [visits, orders, payments] = await Promise.all([
      this.db.visit.findMany({
        where: { workdayId: { in: ids }, deletedAt: null },
        select: { workdayId: true, customerId: true, status: true, isOutOfZone: true, mode: true },
      }),
      this.db.order.groupBy({
        by: ['workdayId'],
        where: { workdayId: { in: ids }, status: { not: 'CANCELLED' }, deletedAt: null },
        _sum: { totalAmount: true },
        _count: true,
      }),
      this.db.payment.groupBy({
        by: ['workdayId'],
        where: { workdayId: { in: ids }, deletedAt: null },
        _sum: { cashAmount: true },
      }),
    ]);

    return Promise.all(
      users.map(async (u) => {
        const w = workdays.find((x) => x.userId === u.id) ?? null;
        const own = visits.filter((v) => v.workdayId === w?.id);
        const done = new Set(own.filter((v) => v.status === 'COMPLETED').map((v) => v.customerId));
        const planned = SELLER_ROLES.includes(u.role.code)
          ? ((await this.planning.day(u.id, date).catch(() => null))?.customers.length ?? 0)
          : 0;
        const o = orders.find((x) => x.workdayId === w?.id);
        const pay = payments.find((x) => x.workdayId === w?.id);
        return {
          id: w?.id ?? null,
          date,
          status: w?.status ?? 'NOT_STARTED',
          user: {
            id: u.id,
            code: u.code,
            name: `${u.firstName} ${u.lastName}`,
            roleName: u.role.name,
          },
          startedAt: w?.startedAt?.toISOString() ?? null,
          closedAt: w?.closedAt?.toISOString() ?? null,
          isForceClosed: w?.isForceClosed ?? false,
          isStartedOffline: w?.isStartedOffline ?? false,
          isClosedOffline: w?.isClosedOffline ?? false,
          reopenCount: w?.reopenCount ?? 0,
          visits: {
            done: done.size,
            planned,
            outOfZone: own.filter((v) => v.isOutOfZone).length,
            byPhone: own.filter((v) => v.mode === 'PHONE' && v.status !== 'MISSED').length,
          },
          ordersCount: o?._count ?? 0,
          ordersAmount: Number(o?._sum.totalAmount ?? 0n),
          collectedAmount: Number(pay?._sum.cashAmount ?? 0n),
        };
      }),
    );
  }

  /**
   * Réouverture (BR-JOU-08) : la journée repasse en cours, ses commandes figées redeviennent
   * modifiables, et ses visites manquées seront recalculées à la prochaine clôture.
   */
  async reopen(actor: AuthUser, id: string, reason: string): Promise<{ workdayId: string }> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const workday = await tx.workday.findFirst({ where: { id, deletedAt: null } });
      if (!workday) throw notFound('Journée introuvable.');
      if (workday.status !== 'CLOSED') throw invalidState("Cette journée n'est pas clôturée.");
      // Après le déchargement, le stock du camion est soldé : la journée est définitive (BR-JOU-08)
      if (await tx.unload.findFirst({ where: { workdayId: id } }))
        throw invalidState('Le camion est déjà déchargé : la journée ne peut plus être rouverte.');
      if (
        await tx.order.findFirst({
          where: { workdayId: id, status: { in: [...PREPARED] }, deletedAt: null },
        })
      )
        throw invalidState('La préparation de ses commandes est lancée : impossible de rouvrir.');
      const open = await tx.workday.findFirst({
        where: { userId: workday.userId, status: 'IN_PROGRESS', deletedAt: null },
      });
      if (open)
        throw invalidState(
          `L'utilisateur a une journée en cours (${dateOnly(open.date)}) : elle doit d'abord être clôturée.`,
        );

      await tx.order.updateMany({
        where: { workdayId: id, status: 'LOCKED', deletedAt: null },
        data: { status: 'CONFIRMED', lockedAt: null },
      });
      await tx.visit.updateMany({
        where: { workdayId: id, status: 'MISSED', deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.workday.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          closedAt: null,
          reopenCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'workday.reopen',
          entity: 'Workday',
          entityId: id,
          reason,
        },
        tx,
      );
    });
    return { workdayId: id };
  }

  /**
   * Clôture d'office (BR-JOU-10) : téléphone perdu ou cassé. Mêmes effets qu'une clôture, sur les
   * opérations déjà reçues ; une visite restée en cours est terminée.
   */
  async forceClose(actor: AuthUser, id: string, reason: string): Promise<{ workdayId: string }> {
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      const workday = await tx.workday.findFirst({ where: { id, deletedAt: null } });
      if (!workday) throw notFound('Journée introuvable.');
      if (workday.status !== 'IN_PROGRESS') throw invalidState("Cette journée n'est pas en cours.");
      const now = new Date();
      await tx.visit.updateMany({
        where: { workdayId: id, status: 'IN_PROGRESS', deletedAt: null },
        data: { status: 'COMPLETED', endedAt: now },
      });
      const missed = await this.workdays.closeEffects(
        tx,
        workday,
        now,
        { byUserId: actor.userId, deviceId: null },
        { isForceClosed: true, forceClosedByUserId: actor.userId },
      );
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'workday.force_close',
          entity: 'Workday',
          entityId: id,
          reason,
          after: { missed },
        },
        tx,
      );
    });
    return { workdayId: id };
  }
}
