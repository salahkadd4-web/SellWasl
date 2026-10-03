// BR-CAT-01 à BR-CAT-16 ; docs/api.md §5.2
import { z } from 'zod';

const reference = z
  .string()
  .trim()
  .min(1, 'Référence obligatoire')
  .max(40)
  .transform((v) => v.toUpperCase());
const label = (max: number) => z.string().trim().min(1, 'Obligatoire').max(max);
const amount = z.number().int('Montant entier en DA').min(0).max(1_000_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

export const THRESHOLD_SCOPES = ['ALL_VARIANTS', 'PER_VARIANT'] as const;
export const FREE_VARIANT_MODES = ['FIXED', 'SELLER_CHOICE', 'AUTO_MOST_STOCK'] as const;

/** Gamme (BR-CAT-01) : base des objectifs. */
export const productRangeSchema = z.object({
  code: reference,
  name: label(80),
  isActive: z.boolean().default(true),
});
export const productCategorySchema = z.object({
  name: label(80),
  isActive: z.boolean().default(true),
});

const packagingSchema = z.object({
  name: label(30),
  /** Nombre d'unités de base dans ce conditionnement (ex. carton = 20). */
  baseQty: z.number().int().min(2, 'Un conditionnement contient au moins 2 unités').max(100_000),
});

export const createProductSchema = z.object({
  reference,
  name: label(120),
  rangeId: z.uuid(),
  categoryId: z.uuid().nullish(),
  /** Unité de base, dans laquelle le stock est tenu (ex. triplette, paquet). */
  baseUnitName: label(30),
  packagings: z.array(packagingSchema).max(10).default([]),
  /** Parfums ; aucun : le produit est un article unique (BR-CAT-12, BR-CAT-13). */
  variants: z
    .array(z.object({ reference, name: label(80) }))
    .max(100)
    .default([]),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    reference,
    name: label(120),
    rangeId: z.uuid(),
    categoryId: z.uuid().nullable(),
    isActive: z.boolean(),
  })
  .partial();

export const createUnitSchema = packagingSchema;
export const updateUnitSchema = z.object({ name: label(30), isActive: z.boolean() }).partial();

export const createVariantSchema = z.object({ reference, name: label(80) });
export const updateVariantSchema = z
  .object({
    reference,
    name: label(80),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial();

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  rangeId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ALL'),
});

export interface ProductRangeDto {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface ProductCategoryDto {
  id: string;
  name: string;
  isActive: boolean;
}
export interface ProductUnitDto {
  id: string;
  name: string;
  baseQty: number;
  isBase: boolean;
  isActive: boolean;
}
/** Photo : taille d'affichage et miniature. */
export interface PhotoDto {
  url: string;
  thumbUrl: string;
}
export interface ProductVariantDto {
  id: string;
  reference: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Photo propre du parfum ; absente : celle du produit. */
  photo: PhotoDto | null;
}
export interface ProductDto {
  id: string;
  reference: string;
  name: string;
  isActive: boolean;
  range: { id: string; code: string; name: string };
  category: { id: string; name: string } | null;
  units: ProductUnitDto[];
  /** Tous les articles ; un produit sans parfum n'a que son article par défaut. */
  variants: ProductVariantDto[];
  hasFlavors: boolean;
  photo: PhotoDto | null;
}

/** Grille de prix d'un produit : types de clients × unités × (produit ou parfum). */
export const priceGridSchema = z.object({
  prices: z
    .array(
      z.object({
        /** null : prix du produit ; sinon prix propre du parfum (BR-CAT-14). */
        variantId: z.uuid().nullable(),
        customerTypeId: z.uuid(),
        unitId: z.uuid(),
        price: amount,
      }),
    )
    .max(5000),
});
export type PriceGridInput = z.input<typeof priceGridSchema>;

export interface PriceGrid {
  productId: string;
  customerTypes: { id: string; code: string; name: string; isActive: boolean }[];
  units: ProductUnitDto[];
  /** Parfums (hors article par défaut), qui peuvent avoir leur propre prix. */
  flavors: ProductVariantDto[];
  prices: { variantId: string | null; customerTypeId: string; unitId: string; price: number }[];
}

export const priceTierSchema = z.object({
  productId: z.uuid(),
  /** Palier propre d'un parfum à prix propre (BR-CAT-15). */
  variantId: z.uuid().nullable().default(null),
  customerTypeId: z.uuid(),
  unitId: z.uuid(),
  minQty: z.number().int().min(2, 'Un palier commence à 2 au moins').max(1_000_000),
  unitPrice: amount,
  thresholdScope: z.enum(THRESHOLD_SCOPES).default('ALL_VARIANTS'),
});
export const updatePriceTierSchema = priceTierSchema
  .pick({ minQty: true, unitPrice: true, thresholdScope: true })
  .partial();

export interface PriceTierDto {
  id: string;
  product: { id: string; reference: string; name: string };
  variant: { id: string; name: string } | null;
  customerType: { id: string; name: string };
  unit: { id: string; name: string };
  minQty: number;
  unitPrice: number;
  thresholdScope: (typeof THRESHOLD_SCOPES)[number];
}

const bonusRuleFields = {
  name: label(120),
  buyProductId: z.uuid(),
  /** Un parfum précis ; null : tous parfums cumulés (BR-CAT-15). */
  buyVariantId: z.uuid().nullable(),
  buyUnitId: z.uuid(),
  buyQty: z.number().int().min(1).max(1_000_000),
  freeProductId: z.uuid(),
  freeVariantId: z.uuid().nullable(),
  freeUnitId: z.uuid(),
  freeQty: z.number().int().min(1).max(1_000_000),
  freeVariantMode: z.enum(FREE_VARIANT_MODES),
  validFrom: date,
  validTo: date.nullable(),
  /** Types de clients visés ; vide : tous. */
  customerTypeIds: z.array(z.uuid()).max(50),
  isActive: z.boolean(),
};
const bonusDates = (v: { validFrom?: string; validTo?: string | null }) =>
  !v.validFrom || !v.validTo || v.validTo >= v.validFrom;
const bonusDatesMessage = { message: 'La fin doit suivre le début', path: ['validTo'] };

export const bonusRuleSchema = z
  .object({
    ...bonusRuleFields,
    buyVariantId: bonusRuleFields.buyVariantId.default(null),
    freeVariantId: bonusRuleFields.freeVariantId.default(null),
    freeVariantMode: bonusRuleFields.freeVariantMode.default('AUTO_MOST_STOCK'),
    validTo: bonusRuleFields.validTo.default(null),
    customerTypeIds: bonusRuleFields.customerTypeIds.default([]),
    isActive: bonusRuleFields.isActive.default(true),
  })
  .refine(bonusDates, bonusDatesMessage);
export const updateBonusRuleSchema = z
  .object(bonusRuleFields)
  .partial()
  .refine(bonusDates, bonusDatesMessage);

export interface BonusRuleDto {
  id: string;
  name: string;
  buyProduct: { id: string; reference: string; name: string };
  buyVariant: { id: string; name: string } | null;
  buyUnit: { id: string; name: string };
  buyQty: number;
  freeProduct: { id: string; reference: string; name: string };
  freeVariant: { id: string; name: string } | null;
  freeUnit: { id: string; name: string };
  freeQty: number;
  freeVariantMode: (typeof FREE_VARIANT_MODES)[number];
  validFrom: string;
  validTo: string | null;
  customerTypes: { id: string; name: string }[];
  isActive: boolean;
}

/** Simulation d'un panier avec la grille en vigueur (docs/api.md §5.2). */
export const simulateCartSchema = z.object({
  customerTypeId: z.uuid(),
  date: date.optional(),
  lines: z
    .array(z.object({ variantId: z.uuid(), unitId: z.uuid(), qty: z.number().int().min(1) }))
    .min(1, 'Ajoutez au moins une ligne')
    .max(200),
});

export interface SimulatedCart {
  lines: {
    productName: string;
    variantName: string | null;
    unitName: string;
    qty: number;
    basePrice: number;
    unitPrice: number;
    tierMinQty: number | null;
    total: number;
  }[];
  freeLines: {
    ruleName: string;
    productName: string;
    variantName: string | null;
    unitName: string;
    qty: number;
  }[];
  unpriced: { productName: string; variantName: string | null; unitName: string; reason: string }[];
  total: number;
}

/**
 * Photos du catalogue, à garder sur le téléphone pour un affichage hors connexion.
 * `file` change quand la photo change : le téléphone ne télécharge que les nouveaux fichiers.
 */
export interface PhotoManifest {
  photos: {
    productId: string;
    /** null : photo du produit, utilisée par les parfums qui n'ont pas la leur. */
    variantId: string | null;
    file: string;
    /** Adresse absolue, ou chemin à compléter par l'adresse de l'API (`/api/v1/media/...`). */
    url: string;
  }[];
}
