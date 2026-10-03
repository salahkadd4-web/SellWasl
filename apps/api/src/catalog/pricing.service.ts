import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { localDate, priceCart, type PricingCatalog } from '@sellwasl/business-rules';
import type {
  BonusRuleDto,
  bonusRuleSchema,
  PriceGrid,
  priceGridSchema,
  PriceTierDto,
  priceTierSchema,
  SimulatedCart,
  simulateCartSchema,
  updateBonusRuleSchema,
  updatePriceTierSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { CatalogService, toProductDto } from './catalog.service';

type Out<T extends z.ZodType> = z.output<T>;

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

const tierInclude = {
  product: true,
  productVariant: true,
  customerType: true,
  unit: true,
} as const satisfies Prisma.PriceTierInclude;
type TierRow = Prisma.PriceTierGetPayload<{ include: typeof tierInclude }>;

const bonusInclude = {
  buyProduct: true,
  buyVariant: true,
  buyUnit: true,
  freeProduct: true,
  freeVariant: true,
  freeUnit: true,
  bonusRuleCustomerTypes: { include: { customerType: true } },
} as const satisfies Prisma.BonusRuleInclude;
type BonusRow = Prisma.BonusRuleGetPayload<{ include: typeof bonusInclude }>;

function toTierDto(t: TierRow): PriceTierDto {
  return {
    id: t.id,
    product: { id: t.product.id, reference: t.product.reference, name: t.product.name },
    variant: t.productVariant ? { id: t.productVariant.id, name: t.productVariant.name } : null,
    customerType: { id: t.customerType.id, name: t.customerType.name },
    unit: { id: t.unit.id, name: t.unit.name },
    minQty: t.minQty,
    unitPrice: Number(t.unitPrice),
    thresholdScope: t.thresholdScope,
  };
}

function toBonusDto(b: BonusRow): BonusRuleDto {
  const product = (p: { id: string; reference: string; name: string }) => ({
    id: p.id,
    reference: p.reference,
    name: p.name,
  });
  return {
    id: b.id,
    name: b.name,
    buyProduct: product(b.buyProduct),
    buyVariant: b.buyVariant ? { id: b.buyVariant.id, name: b.buyVariant.name } : null,
    buyUnit: { id: b.buyUnit.id, name: b.buyUnit.name },
    buyQty: b.buyQty,
    freeProduct: product(b.freeProduct),
    freeVariant: b.freeVariant ? { id: b.freeVariant.id, name: b.freeVariant.name } : null,
    freeUnit: { id: b.freeUnit.id, name: b.freeUnit.name },
    freeQty: b.freeQty,
    freeVariantMode: b.freeVariantMode,
    validFrom: dateOnly(b.validFrom),
    validTo: b.validTo ? dateOnly(b.validTo) : null,
    customerTypes: b.bonusRuleCustomerTypes.map((c) => ({
      id: c.customerType.id,
      name: c.customerType.name,
    })),
    isActive: b.isActive,
  };
}

/** Prix, paliers et bonus (BR-CAT-04 à BR-CAT-07, BR-CAT-14, BR-CAT-15). */
@Injectable()
export class PricingService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  private log(actor: AuthUser, action: string, entity: string, entityId: string, after?: unknown) {
    return this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action,
      entity,
      entityId,
      after: after as Prisma.InputJsonValue,
    });
  }

  private async assertCustomerTypes(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.db.customerType.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length) throw rule('Type de client introuvable.');
  }

  // Grille de prix -----------------------------------------------------------------------------

  async grid(productId: string): Promise<PriceGrid> {
    const product = toProductDto(await this.catalog.find(productId));
    const [customerTypes, prices] = await Promise.all([
      this.db.customerType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.db.price.findMany({ where: { productId, deletedAt: null } }),
    ]);
    return {
      productId,
      customerTypes: customerTypes.map(({ id, code, name, isActive }) => ({
        id,
        code,
        name,
        isActive,
      })),
      units: product.units,
      flavors: product.variants.filter((v) => !v.isDefault),
      prices: prices.map((p) => ({
        variantId: p.productVariantId,
        customerTypeId: p.customerTypeId,
        unitId: p.unitId,
        price: Number(p.price),
      })),
    };
  }

  /**
   * Remplace la grille d'un produit. Les prix retirés sont marqués supprimés, pour que les
   * téléphones les retirent à la synchronisation ; une commande confirmée garde ses prix (BR-CAT-09).
   */
  async putGrid(
    actor: AuthUser,
    productId: string,
    input: Out<typeof priceGridSchema>,
  ): Promise<PriceGrid> {
    const product = await this.catalog.find(productId);
    const unitIds = new Set(product.productUnits.map((u) => u.id));
    const flavorIds = new Set(product.productVariants.filter((v) => !v.isDefault).map((v) => v.id));
    const key = (p: { variantId: string | null; customerTypeId: string; unitId: string }) =>
      `${p.variantId ?? '-'}|${p.customerTypeId}|${p.unitId}`;

    const wanted = new Map<string, (typeof input.prices)[number]>();
    for (const p of input.prices) {
      if (!unitIds.has(p.unitId)) throw rule("Une unité n'appartient pas à ce produit.");
      if (p.variantId && !flavorIds.has(p.variantId))
        throw rule("Un parfum n'appartient pas à ce produit.");
      if (wanted.has(key(p))) throw rule('Un prix est saisi deux fois.');
      wanted.set(key(p), p);
    }
    await this.assertCustomerTypes(input.prices.map((p) => p.customerTypeId));

    const existing = await this.db.price.findMany({ where: { productId } });
    let created = 0;
    let updated = 0;
    let removed = 0;
    await this.db.$transaction(async (tx) => {
      for (const row of existing) {
        const k = key({
          variantId: row.productVariantId,
          customerTypeId: row.customerTypeId,
          unitId: row.unitId,
        });
        const target = wanted.get(k);
        if (target) {
          wanted.delete(k);
          if (row.deletedAt || Number(row.price) !== target.price) {
            updated += 1;
            await tx.price.update({
              where: { id: row.id },
              data: { price: BigInt(target.price), deletedAt: null, version: { increment: 1 } },
            });
          }
        } else if (!row.deletedAt) {
          removed += 1;
          await tx.price.update({
            where: { id: row.id },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          });
        }
      }
      for (const p of wanted.values()) {
        created += 1;
        await tx.price.create({
          data: {
            id: uuidv7(),
            companyId: actor.companyId,
            productId,
            productVariantId: p.variantId,
            customerTypeId: p.customerTypeId,
            unitId: p.unitId,
            price: BigInt(p.price),
            createdByUserId: actor.userId,
          },
        });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'price.update_grid',
          entity: 'Product',
          entityId: productId,
          after: { created, updated, removed },
        },
        tx,
      );
    });
    return this.grid(productId);
  }

  // Paliers ------------------------------------------------------------------------------------

  async tiers(productId?: string): Promise<PriceTierDto[]> {
    const rows = await this.db.priceTier.findMany({
      where: { deletedAt: null, ...(productId && { productId }) },
      include: tierInclude,
      orderBy: [{ product: { name: 'asc' } }, { minQty: 'asc' }],
    });
    return rows.map(toTierDto);
  }

  async createTier(actor: AuthUser, input: Out<typeof priceTierSchema>): Promise<PriceTierDto> {
    const product = await this.catalog.find(input.productId);
    if (!product.productUnits.some((u) => u.id === input.unitId))
      throw rule("Cette unité n'appartient pas au produit.");
    if (
      input.variantId &&
      !product.productVariants.some((v) => v.id === input.variantId && !v.isDefault)
    )
      throw rule("Ce parfum n'appartient pas au produit.");
    await this.assertCustomerTypes([input.customerTypeId]);

    // Un palier supprimé occupe encore sa place dans l'index unique : il est réactivé
    const same = await this.db.priceTier.findFirst({
      where: {
        productId: input.productId,
        productVariantId: input.variantId,
        customerTypeId: input.customerTypeId,
        unitId: input.unitId,
        minQty: input.minQty,
      },
    });
    if (same && !same.deletedAt) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'DUPLICATE',
        `Un palier à partir de ${input.minQty} existe déjà pour ce type de client et cette unité.`,
      );
    }
    const data = {
      unitPrice: BigInt(input.unitPrice),
      thresholdScope: input.thresholdScope,
    };
    const id = same?.id ?? uuidv7();
    if (same) {
      await this.db.priceTier.update({
        where: { id },
        data: { ...data, deletedAt: null, version: { increment: 1 } },
      });
    } else {
      await this.db.priceTier.create({
        data: {
          id,
          companyId: actor.companyId,
          productId: input.productId,
          productVariantId: input.variantId,
          customerTypeId: input.customerTypeId,
          unitId: input.unitId,
          minQty: input.minQty,
          createdByUserId: actor.userId,
          ...data,
        },
      });
    }
    await this.log(actor, 'price_tier.create', 'PriceTier', id, input);
    return toTierDto(
      await this.db.priceTier.findFirstOrThrow({ where: { id }, include: tierInclude }),
    );
  }

  async updateTier(
    actor: AuthUser,
    id: string,
    input: Out<typeof updatePriceTierSchema>,
  ): Promise<PriceTierDto> {
    const tier = await this.db.priceTier.findFirst({ where: { id, deletedAt: null } });
    if (!tier) throw notFound('Palier introuvable.');
    const row = await this.db.priceTier.update({
      where: { id },
      data: {
        ...(input.minQty !== undefined && { minQty: input.minQty }),
        ...(input.unitPrice !== undefined && { unitPrice: BigInt(input.unitPrice) }),
        ...(input.thresholdScope && { thresholdScope: input.thresholdScope }),
        version: { increment: 1 },
      },
      include: tierInclude,
    });
    await this.log(actor, 'price_tier.update', 'PriceTier', id, input);
    return toTierDto(row);
  }

  async deleteTier(actor: AuthUser, id: string): Promise<void> {
    const tier = await this.db.priceTier.findFirst({ where: { id, deletedAt: null } });
    if (!tier) throw notFound('Palier introuvable.');
    await this.db.priceTier.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await this.log(actor, 'price_tier.delete', 'PriceTier', id);
  }

  // Bonus --------------------------------------------------------------------------------------

  async bonusRules(): Promise<BonusRuleDto[]> {
    const rows = await this.db.bonusRule.findMany({
      where: { deletedAt: null },
      include: bonusInclude,
      orderBy: [{ isActive: 'desc' }, { validFrom: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toBonusDto);
  }

  /** Vérifie produits, parfums et unités d'une règle, et normalise le parfum offert. */
  private async checkBonus(rule_: Out<typeof bonusRuleSchema>) {
    const [buy, free] = await Promise.all([
      this.catalog.find(rule_.buyProductId),
      this.catalog.find(rule_.freeProductId),
    ]);
    if (!buy.productUnits.some((u) => u.id === rule_.buyUnitId))
      throw rule("L'unité achetée n'appartient pas au produit acheté.");
    if (!free.productUnits.some((u) => u.id === rule_.freeUnitId))
      throw rule("L'unité offerte n'appartient pas au produit offert.");
    if (
      rule_.buyVariantId &&
      !buy.productVariants.some((v) => v.id === rule_.buyVariantId && !v.isDefault)
    )
      throw rule("Le parfum acheté n'appartient pas au produit acheté.");
    const freeHasFlavors = free.productVariants.some((v) => !v.isDefault);
    if (rule_.freeVariantMode === 'FIXED' && freeHasFlavors) {
      if (
        !rule_.freeVariantId ||
        !free.productVariants.some((v) => v.id === rule_.freeVariantId && !v.isDefault)
      )
        throw rule('Choisissez le parfum offert, ou laissez le choix automatique.');
    }
    await this.assertCustomerTypes(rule_.customerTypeIds);
    return {
      ...rule_,
      freeVariantId:
        rule_.freeVariantMode === 'FIXED' && freeHasFlavors ? rule_.freeVariantId : null,
    };
  }

  private bonusData(r: Out<typeof bonusRuleSchema>) {
    return {
      name: r.name,
      buyProductId: r.buyProductId,
      buyVariantId: r.buyVariantId,
      buyUnitId: r.buyUnitId,
      buyQty: r.buyQty,
      freeProductId: r.freeProductId,
      freeVariantId: r.freeVariantId,
      freeUnitId: r.freeUnitId,
      freeQty: r.freeQty,
      freeVariantMode: r.freeVariantMode,
      validFrom: toDate(r.validFrom),
      validTo: r.validTo ? toDate(r.validTo) : null,
      isActive: r.isActive,
    };
  }

  async createBonus(actor: AuthUser, input: Out<typeof bonusRuleSchema>): Promise<BonusRuleDto> {
    const checked = await this.checkBonus(input);
    const id = uuidv7();
    await this.db.$transaction(async (tx) => {
      await tx.bonusRule.create({
        data: {
          id,
          companyId: actor.companyId,
          createdByUserId: actor.userId,
          ...this.bonusData(checked),
        },
      });
      await tx.bonusRuleCustomerType.createMany({
        data: [...new Set(checked.customerTypeIds)].map((customerTypeId) => ({
          bonusRuleId: id,
          customerTypeId,
        })),
      });
    });
    await this.log(actor, 'bonus_rule.create', 'BonusRule', id, input);
    return toBonusDto(
      await this.db.bonusRule.findFirstOrThrow({ where: { id }, include: bonusInclude }),
    );
  }

  async updateBonus(
    actor: AuthUser,
    id: string,
    input: Out<typeof updateBonusRuleSchema>,
  ): Promise<BonusRuleDto> {
    const current = await this.db.bonusRule.findFirst({
      where: { id, deletedAt: null },
      include: bonusInclude,
    });
    if (!current) throw notFound('Règle de bonus introuvable.');
    const dto = toBonusDto(current);
    const merged: Out<typeof bonusRuleSchema> = {
      name: dto.name,
      buyProductId: dto.buyProduct.id,
      buyVariantId: dto.buyVariant?.id ?? null,
      buyUnitId: dto.buyUnit.id,
      buyQty: dto.buyQty,
      freeProductId: dto.freeProduct.id,
      freeVariantId: dto.freeVariant?.id ?? null,
      freeUnitId: dto.freeUnit.id,
      freeQty: dto.freeQty,
      freeVariantMode: dto.freeVariantMode,
      validFrom: dto.validFrom,
      validTo: dto.validTo,
      customerTypeIds: dto.customerTypes.map((c) => c.id),
      isActive: dto.isActive,
      ...input,
    };
    if (merged.validTo && merged.validTo < merged.validFrom)
      throw rule('La fin doit suivre le début.');
    const checked = await this.checkBonus(merged);
    await this.db.$transaction(async (tx) => {
      await tx.bonusRule.update({
        where: { id },
        data: { ...this.bonusData(checked), version: { increment: 1 } },
      });
      if (input.customerTypeIds) {
        await tx.bonusRuleCustomerType.deleteMany({ where: { bonusRuleId: id } });
        await tx.bonusRuleCustomerType.createMany({
          data: [...new Set(checked.customerTypeIds)].map((customerTypeId) => ({
            bonusRuleId: id,
            customerTypeId,
          })),
        });
      }
    });
    await this.log(actor, 'bonus_rule.update', 'BonusRule', id, input);
    return toBonusDto(
      await this.db.bonusRule.findFirstOrThrow({ where: { id }, include: bonusInclude }),
    );
  }

  async deleteBonus(actor: AuthUser, id: string): Promise<void> {
    const current = await this.db.bonusRule.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw notFound('Règle de bonus introuvable.');
    await this.db.bonusRule.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await this.log(actor, 'bonus_rule.delete', 'BonusRule', id);
  }

  // Calcul -------------------------------------------------------------------------------------

  /** Grille en vigueur pour un type de client : celle que le téléphone utilisera hors connexion. */
  async pricingCatalog(customerTypeId: string): Promise<PricingCatalog> {
    const activeProduct = { deletedAt: null, isActive: true };
    const [units, variants, prices, tiers, rules] = await Promise.all([
      this.db.productUnit.findMany({
        where: { deletedAt: null, isActive: true, product: activeProduct },
      }),
      this.db.productVariant.findMany({ where: { deletedAt: null, product: activeProduct } }),
      this.db.price.findMany({ where: { deletedAt: null, customerTypeId } }),
      this.db.priceTier.findMany({ where: { deletedAt: null, customerTypeId } }),
      this.db.bonusRule.findMany({
        where: { deletedAt: null, isActive: true },
        include: { bonusRuleCustomerTypes: true },
      }),
    ]);
    return {
      units: units.map((u) => ({ id: u.id, productId: u.productId, baseQty: u.baseQty })),
      variants: variants.map((v) => ({ id: v.id, productId: v.productId, isActive: v.isActive })),
      prices: prices.map((p) => ({
        productId: p.productId,
        variantId: p.productVariantId,
        unitId: p.unitId,
        price: Number(p.price),
      })),
      tiers: tiers.map((t) => ({
        productId: t.productId,
        variantId: t.productVariantId,
        unitId: t.unitId,
        minQty: t.minQty,
        unitPrice: Number(t.unitPrice),
        thresholdScope: t.thresholdScope,
      })),
      bonusRules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        buyProductId: r.buyProductId,
        buyVariantId: r.buyVariantId,
        buyUnitId: r.buyUnitId,
        buyQty: r.buyQty,
        freeProductId: r.freeProductId,
        freeVariantId: r.freeVariantId,
        freeUnitId: r.freeUnitId,
        freeQty: r.freeQty,
        freeVariantMode: r.freeVariantMode,
        validFrom: dateOnly(r.validFrom),
        validTo: r.validTo ? dateOnly(r.validTo) : null,
        customerTypeIds: r.bonusRuleCustomerTypes.map((c) => c.customerTypeId),
      })),
    };
  }

  /** Calcule un panier avec la grille en vigueur, pour vérifier prix, paliers et bonus. */
  async simulate(input: Out<typeof simulateCartSchema>): Promise<SimulatedCart> {
    await this.assertCustomerTypes([input.customerTypeId]);
    const company = await this.db.company.findFirstOrThrow();
    const date = input.date ?? localDate(new Date(), company.timezone);
    const catalog = await this.pricingCatalog(input.customerTypeId);
    const cart = priceCart(catalog, input.lines, { customerTypeId: input.customerTypeId, date });

    const ids = [...input.lines.map((l) => l.variantId), ...cart.freeLines.map((l) => l.variantId)];
    const [variants, units] = await Promise.all([
      this.db.productVariant.findMany({ where: { id: { in: ids } }, include: { product: true } }),
      this.db.productUnit.findMany({
        where: {
          id: { in: [...input.lines.map((l) => l.unitId), ...cart.freeLines.map((l) => l.unitId)] },
        },
      }),
    ]);
    const names = (variantId: string, unitId: string) => {
      const v = variants.find((x) => x.id === variantId);
      return {
        productName: v?.product.name ?? 'Article inconnu',
        variantName: v && !v.isDefault ? v.name : null,
        unitName: units.find((u) => u.id === unitId)?.name ?? '?',
      };
    };
    return {
      lines: cart.lines.map((l) => ({
        ...names(l.variantId, l.unitId),
        qty: l.qty,
        basePrice: l.basePrice,
        unitPrice: l.unitPrice,
        tierMinQty: l.tierMinQty,
        total: l.total,
      })),
      freeLines: cart.freeLines.map((l) => ({
        ruleName: l.ruleName,
        ...names(l.variantId, l.unitId),
        qty: l.qty,
      })),
      unpriced: cart.unpriced.map((l) => ({ ...names(l.variantId, l.unitId), reason: l.reason })),
      total: cart.total,
    };
  }
}
