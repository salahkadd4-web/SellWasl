import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { daySummary, localDate } from '@sellwasl/business-rules';
import {
  type DaySummaryDto,
  type ReceiptPrintDto,
  receiptReprintPayload,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth-context';
import { dateOnly, rule, toDate } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { articleName, fullName } from '../stock/stock-helpers';
import { SyncHandlers } from '../sync/sync.handlers';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Tx = Prisma.TransactionClient;

const PAYMENT = {
  customer: true,
  user: true,
  delivery: {
    include: {
      order: {
        include: {
          orderLines: {
            where: { deliveredQty: { gt: 0 } },
            include: { productVariant: { include: { product: true } }, unit: true },
            orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  },
} satisfies Prisma.PaymentInclude;

/**
 * Bons du téléphone (BR-IMP-02 à 06) : de quoi imprimer et réimprimer les bons de livraison, de
 * vente et les reçus de dette ; récapitulatif de journée (BR-PAY-07).
 */
@Injectable()
export class ReceiptsService implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register('receipt.reprint', 'workdays.own', receiptReprintPayload, (ctx) =>
      this.reprint(ctx.actor, ctx.tx, ctx.payload),
    );
  }

  /** Bons de l'utilisateur pour un jour (par défaut, sa journée en cours ou aujourd'hui). */
  async mine(actor: AuthUser, date?: string): Promise<ReceiptPrintDto[]> {
    const day = date ?? (await this.today(actor));
    const payments = await this.db.payment.findMany({
      where: { userId: actor.userId, deletedAt: null, workday: { date: toDate(day) } },
      include: PAYMENT,
      orderBy: { occurredAt: 'asc' },
    });
    const reprints = await this.db.auditLog.groupBy({
      by: ['entityId'],
      where: { action: 'receipt.reprint', entityId: { in: payments.map((p) => p.id) } },
      _count: true,
    });
    return payments.map((p) => {
      const order = p.delivery?.order;
      return {
        number: p.number,
        kind:
          p.kind === 'DEBT_PAYMENT' ? 'DEBT' : order?.source === 'CASH_VAN' ? 'SALE' : 'DELIVERY',
        at: (p.occurredAt ?? p.createdAt).toISOString(),
        user: fullName(p.user),
        customer: { name: p.customer.name, address: p.customer.address },
        lines: (order?.orderLines ?? []).map((l) => {
          const qty = (l.deliveredQty ?? 0) / l.unit.baseQty;
          const free = l.kind === 'BONUS';
          return {
            label: articleName(l.productVariant),
            unitName: l.unit.name,
            qty,
            unitPrice: free ? 0 : Number(l.unitPrice),
            amount: free ? 0 : Number(l.unitPrice) * qty,
            free,
          };
        }),
        total: Number(p.dueAmount),
        paid: Number(p.cashAmount),
        credit: Number(p.creditAmount),
        debtAfter: Number(p.customer.debtAmount),
        reprints: reprints.find((r) => r.entityId === p.id)?._count ?? 0,
      };
    });
  }

  /** Récapitulatif de la journée de l'utilisateur (BR-PAY-07). */
  async mySummary(actor: AuthUser): Promise<DaySummaryDto> {
    const day = await this.today(actor);
    const workday = await this.db.workday.findFirst({
      where: { userId: actor.userId, date: toDate(day), deletedAt: null },
    });
    return this.summary(workday?.id ?? null, actor.userId, day);
  }

  /** Récapitulatif d'une journée (BR-PAY-07), pour le Web. */
  async summary(workdayId: string | null, userId: string, date: string): Promise<DaySummaryDto> {
    const [user, payments] = await Promise.all([
      this.db.user.findFirstOrThrow({ where: { id: userId } }),
      workdayId
        ? this.db.payment.findMany({ where: { workdayId, deletedAt: null } })
        : Promise.resolve([]),
    ]);
    return {
      date,
      user: { id: user.id, code: user.code, name: fullName(user) },
      ...daySummary(
        payments.map((p) => ({
          kind: p.kind,
          dueAmount: Number(p.dueAmount),
          cashAmount: Number(p.cashAmount),
          creditAmount: Number(p.creditAmount),
        })),
      ),
    };
  }

  /** Réimpression d'un bon : marquée « DUPLICATA » sur le téléphone, tracée ici (BR-IMP-03). */
  private async reprint(actor: AuthUser, tx: Tx, payload: z.output<typeof receiptReprintPayload>) {
    const payment = await tx.payment.findFirst({
      where: { number: payload.number, userId: actor.userId, deletedAt: null },
    });
    if (!payment) throw rule('Bon introuvable.');
    await this.audit.write(
      {
        companyId: actor.companyId,
        actorUserId: actor.userId,
        deviceId: actor.deviceId,
        action: 'receipt.reprint',
        entity: 'Payment',
        entityId: payment.id,
        after: { number: payload.number },
      },
      tx,
    );
    return { number: payload.number };
  }

  private async today(actor: AuthUser): Promise<string> {
    const open = await this.db.workday.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (open) return dateOnly(open.date);
    const company = await this.db.company.findFirstOrThrow();
    return localDate(new Date(), company.timezone);
  }
}
