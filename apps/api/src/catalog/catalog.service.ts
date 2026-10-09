import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  PhotoManifest,
  PhotoDto,
  createProductSchema,
  createUnitSchema,
  createVariantSchema,
  ProductCategoryDto,
  productCategorySchema,
  ProductDto,
  productListQuerySchema,
  ProductRangeDto,
  productRangeSchema,
  updateProductSchema,
  updateUnitSchema,
  updateVariantSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ImageStorageService, type UploadedImage } from '../files/image-storage.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Out<T extends z.ZodType> = z.output<T>;

export const productInclude = {
  range: true,
  category: true,
  productUnits: { where: { deletedAt: null }, orderBy: { baseQty: 'asc' } },
  productVariants: {
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
} as const satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);
const duplicate = (field: string, message: string) =>
  new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', message, { field });

export function toProductDto(
  p: ProductRow,
  photo: (key: string | null) => PhotoDto | null = () => null,
): ProductDto {
  return {
    id: p.id,
    reference: p.reference,
    name: p.name,
    isActive: p.isActive,
    version: p.version,
    range: { id: p.range.id, code: p.range.code, name: p.range.name },
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    units: p.productUnits.map((u) => ({
      id: u.id,
      name: u.name,
      baseQty: u.baseQty,
      isBase: u.isBase,
      isActive: u.isActive,
      version: u.version,
    })),
    variants: p.productVariants.map((v) => ({
      id: v.id,
      reference: v.reference,
      name: v.name,
      isDefault: v.isDefault,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
      version: v.version,
      photo: photo(v.photoKey),
    })),
    hasFlavors: p.productVariants.some((v) => !v.isDefault),
    photo: photo(p.photoKey),
    supplierId: p.supplierId,
  };
}

/** Catalogue : gammes, catégories, produits, conditionnements et parfums (UC-81). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly images: ImageStorageService,
  ) {}

  private dto(p: ProductRow): ProductDto {
    return toProductDto(p, (key) => this.images.urls(key));
  }

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

  // Gammes et catégories -----------------------------------------------------------------------

  async ranges(): Promise<ProductRangeDto[]> {
    const rows = await this.db.productRange.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ id, code, name, isActive, version }) => ({
      id,
      code,
      name,
      isActive,
      version,
    }));
  }

  async createRange(actor: AuthUser, input: Out<typeof productRangeSchema>) {
    const id = uuidv7();
    await this.db.productRange.create({
      data: { id, companyId: actor.companyId, ...input, createdByUserId: actor.userId },
    });
    await this.log(actor, 'product_range.create', 'ProductRange', id, input);
    return (await this.ranges()).find((r) => r.id === id)!;
  }

  async updateRange(
    actor: AuthUser,
    id: string,
    input: Partial<Out<typeof productRangeSchema>>,
  ): Promise<ProductRangeDto> {
    const range = await this.db.productRange.findFirst({ where: { id, deletedAt: null } });
    if (!range) throw notFound('Gamme introuvable.');
    const row = await this.db.productRange.update({
      where: { id },
      data: { ...input, version: { increment: 1 } },
    });
    await this.log(actor, 'product_range.update', 'ProductRange', id, input);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      version: row.version,
    };
  }

  async categories(): Promise<ProductCategoryDto[]> {
    const rows = await this.db.productCategory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ id, name, isActive, version }) => ({ id, name, isActive, version }));
  }

  async createCategory(actor: AuthUser, input: Out<typeof productCategorySchema>) {
    const id = uuidv7();
    await this.db.productCategory.create({
      data: { id, companyId: actor.companyId, ...input, createdByUserId: actor.userId },
    });
    await this.log(actor, 'product_category.create', 'ProductCategory', id, input);
    return { id, name: input.name, isActive: input.isActive, version: 1 };
  }

  async updateCategory(
    actor: AuthUser,
    id: string,
    input: Partial<Out<typeof productCategorySchema>>,
  ): Promise<ProductCategoryDto> {
    const category = await this.db.productCategory.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw notFound('Catégorie introuvable.');
    const row = await this.db.productCategory.update({
      where: { id },
      data: { ...input, version: { increment: 1 } },
    });
    await this.log(actor, 'product_category.update', 'ProductCategory', id, input);
    return { id: row.id, name: row.name, isActive: row.isActive, version: row.version };
  }

  // Produits -----------------------------------------------------------------------------------

  async list(query: Out<typeof productListQuerySchema>): Promise<ProductDto[]> {
    const q = query.q;
    const rows = await this.db.product.findMany({
      where: {
        deletedAt: null,
        ...(query.status !== 'ALL' && { isActive: query.status === 'ACTIVE' }),
        ...(query.rangeId && { rangeId: query.rangeId }),
        ...(query.categoryId && { categoryId: query.categoryId }),
        ...(q && {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { reference: { contains: q, mode: 'insensitive' } },
            {
              productVariants: {
                some: {
                  deletedAt: null,
                  OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { reference: { contains: q, mode: 'insensitive' } },
                  ],
                },
              },
            },
          ],
        }),
      },
      include: productInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => this.dto(p));
  }

  async find(id: string): Promise<ProductRow> {
    const product = await this.db.product.findFirst({
      where: { id, deletedAt: null },
      include: productInclude,
    });
    if (!product) throw notFound('Produit introuvable.');
    return product;
  }

  async get(id: string): Promise<ProductDto> {
    return this.dto(await this.find(id));
  }

  /** Une référence identifie un seul produit ou parfum dans l'entreprise. */
  private async assertReferencesFree(references: string[], except: { productId?: string } = {}) {
    const seen = new Set<string>();
    for (const r of references) {
      if (seen.has(r)) throw duplicate('reference', `La référence ${r} est saisie deux fois.`);
      seen.add(r);
    }
    const [products, variants] = await Promise.all([
      this.db.product.findMany({
        where: {
          reference: { in: references, mode: 'insensitive' },
          deletedAt: null,
          ...(except.productId && { id: { not: except.productId } }),
        },
      }),
      this.db.productVariant.findMany({
        where: {
          reference: { in: references, mode: 'insensitive' },
          deletedAt: null,
          ...(except.productId && { productId: { not: except.productId } }),
        },
      }),
    ]);
    const taken = products[0]?.reference ?? variants[0]?.reference;
    if (taken) throw duplicate('reference', `La référence ${taken} est déjà utilisée.`);
  }

  private async assertRangeAndCategory(rangeId?: string, categoryId?: string | null) {
    if (
      rangeId &&
      !(await this.db.productRange.findFirst({ where: { id: rangeId, deletedAt: null } }))
    )
      throw rule('Gamme introuvable.');
    if (
      categoryId &&
      !(await this.db.productCategory.findFirst({ where: { id: categoryId, deletedAt: null } }))
    )
      throw rule('Catégorie introuvable.');
  }

  /**
   * Création d'un produit, de son unité de base, de ses conditionnements et de ses articles :
   * ses parfums, ou un article par défaut invisible s'il n'en a pas (database.md, BR-CAT-13).
   */
  async create(actor: AuthUser, input: Out<typeof createProductSchema>): Promise<ProductDto> {
    await this.assertRangeAndCategory(input.rangeId, input.categoryId);
    const unitNames = [input.baseUnitName, ...input.packagings.map((p) => p.name)].map((n) =>
      n.toLowerCase(),
    );
    if (new Set(unitNames).size !== unitNames.length)
      throw duplicate('packagings', 'Deux unités portent le même nom.');
    const variants =
      input.variants.length > 0
        ? input.variants.map((v) => ({ ...v, isDefault: false }))
        : [{ reference: input.reference, name: input.name, isDefault: true }];
    await this.assertReferencesFree([input.reference, ...input.variants.map((v) => v.reference)]);

    const id = uuidv7();
    await this.db.$transaction(async (tx) => {
      await tx.product.create({
        data: {
          id,
          companyId: actor.companyId,
          reference: input.reference,
          name: input.name,
          rangeId: input.rangeId,
          categoryId: input.categoryId ?? null,
          createdByUserId: actor.userId,
        },
      });
      await tx.productUnit.createMany({
        data: [
          { name: input.baseUnitName, baseQty: 1, isBase: true },
          ...input.packagings.map((p) => ({ ...p, isBase: false })),
        ].map((u) => ({
          id: uuidv7(),
          companyId: actor.companyId,
          productId: id,
          createdByUserId: actor.userId,
          ...u,
        })),
      });
      await tx.productVariant.createMany({
        data: variants.map((v, i) => ({
          id: uuidv7(),
          companyId: actor.companyId,
          productId: id,
          sortOrder: i,
          createdByUserId: actor.userId,
          ...v,
        })),
      });
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'product.create',
          entity: 'Product',
          entityId: id,
          after: input as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return this.get(id);
  }

  async update(
    actor: AuthUser,
    id: string,
    input: Out<typeof updateProductSchema>,
  ): Promise<ProductDto> {
    const product = await this.find(id);
    await this.assertRangeAndCategory(input.rangeId, input.categoryId);
    if (
      input.supplierId &&
      !(await this.db.supplier.findFirst({ where: { id: input.supplierId, deletedAt: null } }))
    )
      throw rule('Fournisseur inconnu.');
    if (input.reference && input.reference !== product.reference)
      await this.assertReferencesFree([input.reference], { productId: id });

    await this.db.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { ...input, version: { increment: 1 } } });
      // L'article par défaut porte la référence et le nom du produit
      const article = product.productVariants.find((v) => v.isDefault);
      if (article && (input.reference || input.name)) {
        await tx.productVariant.update({
          where: { id: article.id },
          data: {
            reference: input.reference ?? article.reference,
            name: input.name ?? article.name,
            version: { increment: 1 },
          },
        });
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'product.update',
          entity: 'Product',
          entityId: id,
          after: input as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // Conditionnements ---------------------------------------------------------------------------

  /** Le nombre d'unités de base d'un conditionnement ne change pas : il convertit le stock. */
  async addUnit(
    actor: AuthUser,
    productId: string,
    input: Out<typeof createUnitSchema>,
  ): Promise<ProductDto> {
    const product = await this.find(productId);
    if (product.productUnits.some((u) => u.name.toLowerCase() === input.name.toLowerCase()))
      throw duplicate('name', `L'unité ${input.name} existe déjà pour ce produit.`);
    const id = uuidv7();
    await this.db.productUnit.create({
      data: {
        id,
        companyId: actor.companyId,
        productId,
        name: input.name,
        baseQty: input.baseQty,
        createdByUserId: actor.userId,
      },
    });
    await this.log(actor, 'product_unit.create', 'ProductUnit', id, input);
    return this.get(productId);
  }

  async updateUnit(
    actor: AuthUser,
    productId: string,
    unitId: string,
    input: Out<typeof updateUnitSchema>,
  ): Promise<ProductDto> {
    const product = await this.find(productId);
    const unit = product.productUnits.find((u) => u.id === unitId);
    if (!unit) throw notFound('Unité introuvable.');
    if (unit.isBase && input.isActive === false)
      throw rule(
        "L'unité de base ne peut pas être désactivée : le stock est tenu dans cette unité.",
      );
    if (
      input.name &&
      product.productUnits.some(
        (u) => u.id !== unitId && u.name.toLowerCase() === input.name!.toLowerCase(),
      )
    )
      throw duplicate('name', `L'unité ${input.name} existe déjà pour ce produit.`);
    await this.db.productUnit.update({
      where: { id: unitId },
      data: { ...input, version: { increment: 1 } },
    });
    await this.log(actor, 'product_unit.update', 'ProductUnit', unitId, input);
    return this.get(productId);
  }

  // Parfums ------------------------------------------------------------------------------------

  /**
   * Ajout d'un parfum (BR-CAT-12). Pour un produit qui n'en avait pas, son article devient le
   * premier parfum : il garde son stock et son historique.
   */
  async addVariant(
    actor: AuthUser,
    productId: string,
    input: Out<typeof createVariantSchema>,
  ): Promise<ProductDto> {
    const product = await this.find(productId);
    const article = product.productVariants.find((v) => v.isDefault);
    await this.assertReferencesFree([input.reference], { productId });
    if (product.productVariants.some((v) => !v.isDefault && v.reference === input.reference))
      throw duplicate('reference', `La référence ${input.reference} est déjà utilisée.`);

    let variantId: string;
    if (article) {
      variantId = article.id;
      await this.db.productVariant.update({
        where: { id: article.id },
        data: { ...input, isDefault: false, version: { increment: 1 } },
      });
    } else {
      variantId = uuidv7();
      const sortOrder = Math.max(-1, ...product.productVariants.map((v) => v.sortOrder)) + 1;
      await this.db.productVariant.create({
        data: {
          id: variantId,
          companyId: actor.companyId,
          productId,
          ...input,
          sortOrder,
          createdByUserId: actor.userId,
        },
      });
    }
    await this.log(actor, 'product_variant.create', 'ProductVariant', variantId, {
      ...input,
      fromArticle: !!article,
    });
    return this.get(productId);
  }

  async updateVariant(
    actor: AuthUser,
    productId: string,
    variantId: string,
    input: Out<typeof updateVariantSchema>,
  ): Promise<ProductDto> {
    const product = await this.find(productId);
    const variant = product.productVariants.find((v) => v.id === variantId);
    if (!variant) throw notFound('Parfum introuvable.');
    if (variant.isDefault)
      throw rule("Ce produit n'a pas de parfum : modifiez le produit lui-même.");
    if (input.reference && input.reference !== variant.reference) {
      await this.assertReferencesFree([input.reference], { productId });
      if (
        product.productVariants.some((v) => v.id !== variantId && v.reference === input.reference)
      )
        throw duplicate('reference', `La référence ${input.reference} est déjà utilisée.`);
    }
    if (
      input.isActive === false &&
      variant.isActive &&
      product.productVariants.filter((v) => v.isActive).length === 1
    ) {
      throw rule('Gardez au moins un parfum actif, ou désactivez le produit.');
    }
    await this.db.productVariant.update({
      where: { id: variantId },
      data: { ...input, version: { increment: 1 } },
    });
    await this.log(actor, 'product_variant.update', 'ProductVariant', variantId, input);
    return this.get(productId);
  }

  /** Photos des produits et parfums actifs, pour le téléchargement en bloc du téléphone. */
  async photoManifest(): Promise<PhotoManifest> {
    const products = await this.db.product.findMany({
      where: { deletedAt: null, isActive: true },
      include: { productVariants: { where: { deletedAt: null, isActive: true } } },
    });
    const entry = (productId: string, variantId: string | null, key: string | null) => {
      const urls = this.images.urls(key);
      if (!key || !urls) return [];
      // Cloudinary livre du WebP ; une photo locale garde son format
      const ext = key.startsWith('local:') ? key.slice(key.lastIndexOf('.') + 1) : 'webp';
      const file = `${createHash('sha1').update(key).digest('hex').slice(0, 20)}.${ext}`;
      return [{ productId, variantId, file, url: urls.mobileUrl }];
    };
    return {
      photos: products.flatMap((p) => [
        ...entry(p.id, null, p.photoKey),
        ...p.productVariants.flatMap((v) => entry(p.id, v.id, v.photoKey)),
      ]),
    };
  }

  // Photos ---------------------------------------------------------------------------------------

  /**
   * Photo du produit, ou d'un parfum (`variantId`). L'ancienne photo est supprimée après
   * l'enregistrement de la nouvelle ; `file` absent : la photo est retirée.
   */
  async setPhoto(
    actor: AuthUser,
    productId: string,
    variantId: string | null,
    file: UploadedImage | undefined | null,
  ): Promise<ProductDto> {
    const product = await this.find(productId);
    const variant = variantId ? product.productVariants.find((v) => v.id === variantId) : null;
    if (variantId && (!variant || variant.isDefault)) throw notFound('Parfum introuvable.');
    const previous = variant ? variant.photoKey : product.photoKey;
    const photoKey =
      file === null
        ? null
        : await this.images.save(actor.companyId, variant ? 'flavors' : 'products', file);
    const data = { photoKey, version: { increment: 1 } };
    if (variant) await this.db.productVariant.update({ where: { id: variant.id }, data });
    else await this.db.product.update({ where: { id: productId }, data });
    await this.log(
      actor,
      photoKey ? 'product.photo.set' : 'product.photo.remove',
      variant ? 'ProductVariant' : 'Product',
      variant?.id ?? productId,
    );
    await this.images.remove(previous);
    return this.get(productId);
  }
}
