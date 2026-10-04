import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { distanceMeters } from '@sellwasl/business-rules';
import { visitCloseNoOrderPayload, visitStartPayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PlanningService } from '../planning/planning.service';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { dateOnly, invalidState, rule } from './field-errors';
import { WorkdayService } from './workday.service';

type StartPayload = z.output<typeof visitStartPayload>;
type CloseNoOrderPayload = z.output<typeof visitCloseNoOrderPayload>;

/** Visites du vendeur (BR-VIS, UC-13, UC-16), reçues par la synchronisation. */
@Injectable()
export class VisitService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly workdays: WorkdayService,
    private readonly planning: PlanningService,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('visit.start', 'visits.own', visitStartPayload, (ctx) =>
      this.start(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
    this.handlers.register('visit.close_no_order', 'visits.own', visitCloseNoOrderPayload, (ctx) =>
      this.closeNoOrder(ctx.actor, ctx.tx, ctx.payload, new Date(ctx.op.occurredAt)),
    );
  }

  /** Client du secteur du vendeur, actif. */
  async sectorCustomer(tx: Prisma.TransactionClient, actor: AuthUser, customerId: string) {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null, territory: { sellerUserId: actor.userId } },
    });
    if (!customer) throw notFound('Client introuvable dans votre secteur.');
    if (customer.status !== 'ACTIVE') throw rule('Ce client est désactivé.');
    return customer;
  }

  private async start(
    actor: AuthUser,
    tx: Prisma.TransactionClient,
    payload: StartPayload,
    occurredAt: Date,
  ) {
    const workday = await this.workdays.openWorkday(tx, actor);
    const customer = await this.sectorCustomer(tx, actor, payload.customerId);
    if (payload.mode === 'PHONE' && actor.roleCode === 'VENDEUR_CASH_VAN')
      throw rule('En cash van, la visite se fait sur place.', { rule: 'BR-VIS-03' });
    const current = await tx.visit.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (current) throw invalidState("Terminez d'abord la visite en cours.");

    const date = dateOnly(workday.date);
    const [day, rules] = await Promise.all([
      this.planning.day(actor.userId, date),
      this.workdays.fieldRules(),
    ]);
    const isScheduled = day.customers.some((c) => c.id === customer.id);
    if (!isScheduled && !rules.rules.P02_outOfProgramVisits)
      throw rule("L'entreprise n'autorise pas les visites hors programme.", { rule: 'BR-VIS-07' });

    // Sur place : distance calculée, « hors zone » signalé mais jamais bloquant (BR-VIS-02)
    const phone =
      payload.latitude != null && payload.longitude != null
        ? { latitude: payload.latitude, longitude: payload.longitude }
        : null;
    const customerPosition =
      customer.latitude != null && customer.longitude != null
        ? { latitude: customer.latitude, longitude: customer.longitude }
        : null;
    const onSite = payload.mode === 'ON_SITE';
    const distanceM =
      onSite && phone && customerPosition ? distanceMeters(phone, customerPosition) : null;
    const isOutOfZone =
      onSite &&
      (distanceM === null ? customerPosition !== null : distanceM > rules.outOfZoneDistanceM);

    await tx.visit.create({
      data: {
        id: payload.visitId,
        companyId: actor.companyId,
        date: workday.date,
        mode: payload.mode,
        status: 'IN_PROGRESS',
        isScheduled,
        startedAt: occurredAt,
        latitude: phone?.latitude ?? null,
        longitude: phone?.longitude ?? null,
        distanceM,
        isOutOfZone,
        isCustomerPositionUnknown: onSite && !customerPosition,
        workdayId: workday.id,
        userId: actor.userId,
        customerId: customer.id,
        createdByUserId: actor.userId,
        createdByDeviceId: actor.deviceId,
        occurredAt,
      },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'visit.start',
        entity: 'Visit',
        entityId: payload.visitId,
        after: { customerId: customer.id, mode: payload.mode, distanceM, isOutOfZone, isScheduled },
      },
      tx,
    );
    return { visitId: payload.visitId, distanceM, isOutOfZone, isScheduled };
  }

  private async closeNoOrder(
    actor: AuthUser,
    tx: Prisma.TransactionClient,
    payload: CloseNoOrderPayload,
    occurredAt: Date,
  ) {
    const visit = await tx.visit.findFirst({
      where: { id: payload.visitId, userId: actor.userId, deletedAt: null },
    });
    if (!visit) throw notFound('Visite introuvable.');
    if (visit.status !== 'IN_PROGRESS') throw invalidState('Cette visite est déjà terminée.');
    const reason = await tx.reason.findFirst({
      where: { id: payload.reasonId, kind: 'NO_ORDER', isActive: true, deletedAt: null },
    });
    if (!reason) throw rule('Motif de non-commande introuvable.');

    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: 'COMPLETED',
        outcome: 'NO_ORDER',
        reasonId: reason.id,
        endedAt: occurredAt,
        version: { increment: 1 },
      },
    });
    // « Fermé définitivement » : le client rejoint la liste « clients à revoir » (BR-VIS-05)
    if (reason.systemCode === 'CLOSED_PERMANENTLY')
      await tx.customer.update({
        where: { id: visit.customerId },
        data: { isClosedPermanently: true, version: { increment: 1 } },
      });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'visit.close',
        entity: 'Visit',
        entityId: visit.id,
        after: { outcome: 'NO_ORDER', reason: reason.label },
      },
      tx,
    );
    return { visitId: visit.id };
  }
}
