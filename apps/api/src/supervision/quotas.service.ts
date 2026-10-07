import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import { companySettingsSchema, type putQuotasSchema, type QuotaDto } from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { dateOnly, rule, toDate } from '../field/field-errors';
import { OrderService } from '../field/order.service';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'] as const;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** Quotas du jour par vendeur et article (BR-QUO-01, UC-55), stockés en unité de base. */
@Injectable()
export class QuotasService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly orders: OrderService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(date: string, userId?: string): Promise<QuotaDto[]> {
    const tx = this.db as unknown as Prisma.TransactionClient;
    const [quotas, settings] = await Promise.all([
      this.db.quota.findMany({
        where: { date: toDate(date), deletedAt: null, ...(userId ? { userId } : {}) },
        include: { user: true, productVariant: { include: { product: true } }, enteredUnit: true },
        orderBy: [{ user: { code: 'asc' } }, { productVariant: { reference: 'asc' } }],
      }),
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    const P03 = companySettingsSchema.parse(settings?.data ?? {}).rules.P03_bonusConsumesQuota;
    const consumedByUser = new Map<string, Map<string, number>>();
    for (const userId of new Set(quotas.map((q) => q.userId)))
      consumedByUser.set(userId, await this.orders.consumedQuota(tx, userId, date, P03));
    return quotas.map((q) => ({
      id: q.id,
      date: dateOnly(q.date),
      user: { id: q.user.id, code: q.user.code, name: fullName(q.user) },
      productVariantId: q.productVariantId,
      productName: q.productVariant.product.name,
      variantName: q.productVariant.isDefault ? null : q.productVariant.name,
      qty: q.qty,
      enteredQty: q.enteredQty,
      enteredUnit: { id: q.enteredUnit.id, name: q.enteredUnit.name },
      consumedQty: consumedByUser.get(q.userId)?.get(q.productVariantId) ?? 0,
    }));
  }

  async put(actor: AuthUser, input: z.output<typeof putQuotasSchema>): Promise<QuotaDto[]> {
    const company = await this.db.company.findFirstOrThrow();
    if (input.date < localDate(new Date(), company.timezone))
      throw rule('On ne fixe pas de quota pour un jour passé.');
    const [sellers, variants, units] = await Promise.all([
      this.db.user.findMany({
        where: {
          id: { in: input.entries.map((e) => e.userId) },
          deletedAt: null,
          role: { code: { in: [...SELLER_ROLES] } },
        },
      }),
      this.db.productVariant.findMany({
        where: { id: { in: input.entries.map((e) => e.productVariantId) }, deletedAt: null },
      }),
      this.db.productUnit.findMany({
        where: { id: { in: input.entries.map((e) => e.unitId) }, deletedAt: null },
      }),
    ]);

    await this.db.$transaction(async (tenantTx) => {
      const tx = tenantTx as unknown as Prisma.TransactionClient;
      for (const e of input.entries) {
        if (!sellers.some((s) => s.id === e.userId)) throw rule('Vendeur introuvable.');
        const variant = variants.find((v) => v.id === e.productVariantId);
        const unit = units.find((u) => u.id === e.unitId);
        if (!variant || !unit || unit.productId !== variant.productId)
          throw rule('Unité inconnue pour cet article.');
        const where = {
          companyId_userId_productVariantId_date: {
            companyId: actor.companyId,
            userId: e.userId,
            productVariantId: e.productVariantId,
            date: toDate(input.date),
          },
        };
        if (e.qty === 0) {
          await tx.quota.updateMany({
            where: {
              userId: e.userId,
              productVariantId: e.productVariantId,
              date: toDate(input.date),
            },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          });
          continue;
        }
        const values = {
          qty: e.qty * unit.baseQty,
          enteredQty: e.qty,
          enteredUnitId: unit.id,
          deletedAt: null,
        };
        await tx.quota.upsert({
          where,
          create: {
            id: uuidv7(),
            companyId: actor.companyId,
            userId: e.userId,
            productVariantId: e.productVariantId,
            date: toDate(input.date),
            createdByUserId: actor.userId,
            ...values,
          },
          update: { ...values, version: { increment: 1 } },
        });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'quota.update',
          entity: 'Quota',
          after: { date: input.date, entries: input.entries.length },
        },
        tx,
      );
      // Chaque vendeur concerné est prévenu (BR-NOT-03)
      await this.notifications.notify(tx, {
        companyId: actor.companyId,
        type: 'QUOTA_CHANGED',
        title: 'Quota modifié',
        body: `Vos quotas du ${input.date.split('-').reverse().join('/')} ont changé.`,
        to: { userIds: [...new Set(input.entries.map((e) => e.userId))] },
        actorUserId: actor.userId,
      });
    });
    this.notifications.kick();
    return this.list(input.date);
  }
}
