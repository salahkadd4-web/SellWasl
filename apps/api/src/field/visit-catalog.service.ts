import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '@sellwasl/business-rules';
import { companySettingsSchema, type VisitCatalog } from '@sellwasl/validation';
import type { AuthUser } from '../common/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { dateOnly, toDate } from './field-errors';
import { OrderService } from './order.service';
import { VisitService } from './visit.service';

/**
 * Catalogue proposable à un client pendant la visite (BR-CMD-06, BR-CAT-11) : articles qui ont un
 * prix pour son type et du stock disponible au dépôt, avec la grille de prix et le quota restant.
 * Les quantités en stock ne sont pas envoyées.
 */
@Injectable()
export class VisitCatalogService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly orders: OrderService,
    private readonly visits: VisitService,
  ) {}

  async forCustomer(
    actor: AuthUser,
    customerId: string,
    requested?: string,
  ): Promise<VisitCatalog> {
    const tx = this.db as unknown as Prisma.TransactionClient;
    const customer = await this.visits.sectorCustomer(tx, actor, customerId);
    const date = requested ?? (await this.defaultDate(actor));
    const [catalog, available, settingsRow, quotas, products] = await Promise.all([
      this.orders.catalogFor(customer.customerTypeId),
      this.orders.availableStock(tx),
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
      this.db.quota.findMany({
        where: { userId: actor.userId, date: toDate(date), deletedAt: null },
      }),
      this.db.product.findMany({
        where: { deletedAt: null, isActive: true },
        include: {
          range: true,
          category: true,
          productUnits: { where: { deletedAt: null, isActive: true }, orderBy: { baseQty: 'asc' } },
          productVariants: {
            where: { deletedAt: null, isActive: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    const P03 = companySettingsSchema.parse(settingsRow?.data ?? {}).rules.P03_bonusConsumesQuota;
    const consumed = await this.orders.consumedQuota(tx, actor.userId, date, P03);

    const priced = (productId: string, variantId: string) =>
      catalog.prices.some(
        (p) => p.productId === productId && (p.variantId === variantId || p.variantId === null),
      );
    const pricedUnit = (productId: string, unitId: string) =>
      catalog.prices.some((p) => p.productId === productId && p.unitId === unitId);

    return {
      customerId: customer.id,
      customerTypeId: customer.customerTypeId,
      date,
      catalog,
      products: products
        .map((p) => ({
          id: p.id,
          name: p.name,
          reference: p.reference,
          range: { id: p.range.id, name: p.range.name },
          category: p.category ? { id: p.category.id, name: p.category.name } : null,
          hasFlavors: p.productVariants.some((v) => !v.isDefault),
          units: p.productUnits
            .filter((u) => pricedUnit(p.id, u.id))
            .map((u) => ({ id: u.id, name: u.name, baseQty: u.baseQty })),
          variants: p.productVariants
            .filter((v) => priced(p.id, v.id) && (available.get(v.id) ?? 0) > 0)
            .map((v) => {
              const quota = quotas.find((q) => q.productVariantId === v.id);
              const remaining = quota ? Math.max(0, quota.qty - (consumed.get(v.id) ?? 0)) : null;
              return {
                id: v.id,
                name: v.isDefault ? p.name : v.name,
                quotaRemaining: remaining,
                quotaReached: remaining === 0,
              };
            }),
        }))
        .filter((p) => p.variants.length > 0 && p.units.length > 0),
      rules: { P03_bonusConsumesQuota: P03 },
    };
  }

  /** Date de la journée en cours, sinon le jour de l'entreprise. */
  private async defaultDate(actor: AuthUser): Promise<string> {
    const workday = await this.db.workday.findFirst({
      where: { userId: actor.userId, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (workday) return dateOnly(workday.date);
    const company = await this.db.company.findFirstOrThrow();
    return localDate(new Date(), company.timezone);
  }
}
