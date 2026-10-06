import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import { type RefusalDto, refusalContestPayload } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, invalidState, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleName, fullName } from '../stock/stock-helpers';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

const DETAIL = {
  order: { include: { customer: true, sellerUser: true } },
  user: true,
  refusalReason: true,
} satisfies Prisma.DeliveryInclude;
type Row = Prisma.DeliveryGetPayload<{ include: typeof DETAIL }>;

/**
 * Contestation d'un refus (phase 21) : le pré-vendeur conteste un refus déclaré par le livreur sur
 * l'une de ses commandes ; le superviseur la retient ou la rejette, une seule fois.
 */
@Injectable()
export class RefusalsService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('refusal.contest', 'returns.contest', refusalContestPayload, (ctx) =>
      this.contest(ctx.actor, ctx.tx, ctx.payload),
    );
  }

  private async contest(
    actor: AuthUser,
    tx: Tx,
    payload: z.output<typeof refusalContestPayload>,
  ): Promise<{ deliveryId: string; contestStatus: string }> {
    const delivery = await tx.delivery.findFirst({
      where: { id: payload.deliveryId, deletedAt: null },
      include: { order: true },
    });
    if (!delivery || delivery.order.sellerUserId !== actor.userId)
      throw notFound('Refus introuvable dans vos commandes.');
    if (!delivery.refusalReasonId) throw invalidState("Cette livraison n'a pas de refus.");
    if (delivery.contestStatus !== 'NONE') throw invalidState('Ce refus est déjà contesté.');
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        contestStatus: 'CONTESTED',
        contestComment: payload.comment,
        contestedAt: new Date(),
        version: { increment: 1 },
      },
    });
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'refusal.contest',
        entity: 'Delivery',
        entityId: delivery.id,
        after: { comment: payload.comment },
      },
      tx,
    );
    return { deliveryId: delivery.id, contestStatus: 'CONTESTED' };
  }

  /** Refus des commandes du pré-vendeur (par défaut, les 30 derniers jours). */
  async mine(actor: AuthUser, from?: string, to?: string): Promise<RefusalDto[]> {
    const company = await this.db.company.findFirstOrThrow();
    const end = to ?? localDate(new Date(), company.timezone);
    const start = from ?? dateOnly(new Date(toDate(end).getTime() - 29 * 86_400_000));
    const rows = await this.db.delivery.findMany({
      where: {
        deletedAt: null,
        refusalReasonId: { not: null },
        order: { sellerUserId: actor.userId },
        workday: { date: { gte: toDate(start), lte: toDate(end) } },
      },
      include: DETAIL,
      orderBy: { createdAt: 'desc' },
    });
    return this.toDtos(rows);
  }

  async contested(): Promise<RefusalDto[]> {
    const rows = await this.db.delivery.findMany({
      where: { deletedAt: null, contestStatus: 'CONTESTED' },
      include: DETAIL,
      orderBy: { contestedAt: 'asc' },
    });
    return this.toDtos(rows);
  }

  async decide(actor: AuthUser, deliveryId: string, upheld: boolean): Promise<RefusalDto> {
    const delivery = await this.db.delivery.findFirst({
      where: { id: deliveryId, deletedAt: null },
    });
    if (!delivery || !delivery.refusalReasonId) throw notFound('Refus introuvable.');
    if (delivery.contestStatus !== 'CONTESTED')
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONFLICT',
        delivery.contestStatus === 'NONE'
          ? "Ce refus n'est pas contesté."
          : 'Cette contestation est déjà tranchée.',
      );
    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Tx;
      await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          contestStatus: upheld ? 'UPHELD' : 'REJECTED',
          contestDecidedByUserId: actor.userId,
          contestDecidedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'refusal.decide',
          entity: 'Delivery',
          entityId: deliveryId,
          after: { upheld },
        },
        tx,
      );
    });
    const row = await this.db.delivery.findFirstOrThrow({
      where: { id: deliveryId },
      include: DETAIL,
    });
    return (await this.toDtos([row]))[0]!;
  }

  private async toDtos(rows: Row[]): Promise<RefusalDto[]> {
    const facts = await this.db.returnFact.findMany({
      where: { kind: 'REFUSAL', deliveryId: { in: rows.map((r) => r.id) } },
    });
    const variants = await this.db.productVariant.findMany({
      where: { id: { in: [...new Set(facts.map((f) => f.productVariantId))] } },
      include: { product: true },
    });
    const workdays = await this.db.workday.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.workdayId))] } },
    });
    return rows.map((r) => {
      const mine = facts.filter((f) => f.deliveryId === r.id);
      return {
        deliveryId: r.id,
        number: r.number,
        date: dateOnly(workdays.find((w) => w.id === r.workdayId)?.date ?? r.createdAt),
        result: r.result === 'FAILED' ? 'FAILED' : 'PARTIAL',
        order: { id: r.order.id, number: r.order.number },
        customer: { id: r.order.customer.id, name: r.order.customer.name },
        seller: fullName(r.order.sellerUser),
        driver: fullName(r.user),
        reason: r.refusalReason?.label ?? null,
        refusedValue: mine.reduce((sum, f) => sum + Number(f.value), 0),
        lines: mine.map((f) => {
          const variant = variants.find((v) => v.id === f.productVariantId);
          return { article: variant ? articleName(variant) : 'Article', qty: f.qty };
        }),
        contestStatus: r.contestStatus,
        contestComment: r.contestComment,
        contestedAt: r.contestedAt?.toISOString() ?? null,
        decidedAt: r.contestDecidedAt?.toISOString() ?? null,
      };
    });
  }
}
