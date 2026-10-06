// Entrepôt et stock (phase 17) : entrées, inventaires, chargements, déchargements, consultation
import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const qty = z.number().int().min(0).max(1_000_000);

export const STOCK_MOVEMENT_TYPES = [
  'IN',
  'OUT',
  'TRANSFER',
  'RESERVATION',
  'RELEASE',
  'ADJUSTMENT',
  'WRITE_OFF',
] as const;
export type StockMovementTypeCode = (typeof STOCK_MOVEMENT_TYPES)[number];

/** État constaté au déchargement (phase 21). */
export const RETURN_CONDITIONS = ['RESTOCK', 'DEFECTIVE', 'EXPIRED', 'BROKEN'] as const;
export type ReturnConditionCode = (typeof RETURN_CONDITIONS)[number];

/** Une quantité saisie dans une unité du produit, convertie en unité de base par le serveur. */
export const stockLineSchema = z.object({
  variantId: z.uuid(),
  unitId: z.uuid(),
  qty,
});

const uniqueVariants = <T extends { variantId: string }>(lines: T[]) =>
  new Set(lines.map((l) => l.variantId)).size === lines.length;
const ONCE = { message: "Un article ne peut figurer qu'une fois." };

/** Lignes d'une entrée ou d'un chargement : au moins une, quantités positives. */
const positiveLines = z
  .array(stockLineSchema.extend({ qty: qty.min(1) }))
  .min(1)
  .max(200)
  .refine(uniqueVariants, ONCE);

export const createReceiptSchema = z.object({
  warehouseId: z.uuid(),
  reference: z.string().trim().max(60).optional(),
  supplier: z.string().trim().max(120).optional(),
  supplierId: z.uuid().optional(),
  lines: z
    .array(
      stockLineSchema.extend({
        qty: qty.min(1),
        lotNumber: z.string().trim().min(1).max(40).optional(),
        expiresAt: date.optional(),
      }),
    )
    .min(1)
    .max(200)
    .refine(uniqueVariants, ONCE),
});

export const createInventorySchema = z.object({ warehouseId: z.uuid() });

export const inventoryLinesSchema = z.object({
  lines: z.array(stockLineSchema).max(500).refine(uniqueVariants, ONCE),
});

export const createLoadSchema = z.object({
  truckId: z.uuid(),
  date,
  fromWarehouseId: z.uuid().optional(),
  lines: positiveLines,
});

export const createUnloadSchema = z.object({
  workdayId: z.uuid(),
  lines: z
    .array(z.object({ variantId: z.uuid(), countedQty: qty, reasonId: z.uuid().optional() }))
    .max(500)
    .refine(uniqueVariants, ONCE),
  /** Répartition du compté par état constaté (phase 21) ; absente : tout est remis en stock. */
  conditions: z
    .array(
      z.object({
        variantId: z.uuid(),
        condition: z.enum(RETURN_CONDITIONS),
        qty: qty.min(1),
        lotId: z.uuid().optional(),
        photoKey: z.string().min(1).max(300).optional(),
      }),
    )
    .max(2000)
    .optional(),
});

export const putThresholdsSchema = z.object({
  entries: z
    .array(z.object({ variantId: z.uuid(), lowStockQty: qty.nullable() }))
    .min(1)
    .max(500)
    .refine(uniqueVariants, ONCE),
});

export const stockQuerySchema = z.object({ warehouseId: z.uuid().optional() });
export const movementsQuerySchema = z.object({
  warehouseId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  from: date.optional(),
  to: date.optional(),
});
export const dateRangeQuerySchema = z.object({ from: date.optional(), to: date.optional() });
export const loadsQuerySchema = z.object({ date: date.optional() });
export const unloadsQuerySchema = z.object({ date: date.optional() });
export const unloadPreviewQuerySchema = z.object({ workdayId: z.uuid() });

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
  type: 'DEPOT' | 'TRUCK';
}

interface ArticleRef {
  variantId: string;
  productName: string;
  /** Nom du parfum, ou null pour la variante par défaut. */
  variantName: string | null;
}

export interface StockRowDto extends ArticleRef {
  physical: number;
  reserved: number;
  available: number;
  lowStockQty: number | null;
  isLow: boolean;
}

export interface StockMovementDto extends ArticleRef {
  id: string;
  type: StockMovementTypeCode;
  qty: number;
  occurredAt: string;
  from: WarehouseRef | null;
  to: WarehouseRef | null;
  user: { id: string; name: string };
  reason: string | null;
  sourceType: string | null;
}

export interface StockAlertDto extends ArticleRef {
  warehouse: WarehouseRef;
  available: number;
  lowStockQty: number;
}

export interface ReceiptDto {
  id: string;
  warehouse: WarehouseRef;
  reference: string | null;
  supplier: string | null;
  receivedAt: string;
  user: string | null;
  supplierRef: { id: string; name: string } | null;
  lines: (ArticleRef & {
    unitName: string;
    enteredQty: number;
    qty: number;
    lotNumber: string | null;
    expiresAt: string | null;
  })[];
}

export interface InventoryDto {
  id: string;
  warehouse: WarehouseRef;
  status: 'DRAFT' | 'VALIDATED';
  createdAt: string;
  validatedAt: string | null;
  lines: (ArticleRef & { expectedQty: number; countedQty: number; gapQty: number })[];
}

export interface InventoryResult {
  adjustments: number;
  releasedLines: {
    orderNumber: string;
    customerName: string;
    variantId: string;
    released: number;
  }[];
}

interface PersonRef {
  id: string;
  code: string;
  name: string;
}

export interface LoadDto {
  id: string;
  kind: 'ROUTE' | 'CASH_VAN' | 'RELOAD';
  date: string;
  status: 'PLANNED' | 'LOADED' | 'RECEIVED';
  truck: WarehouseRef;
  user: PersonRef;
  loadedAt: string | null;
  lines: (ArticleRef & { qty: number })[];
}

export interface PendingUnloadDto {
  workdayId: string;
  date: string;
  truck: WarehouseRef;
  user: PersonRef;
}

export interface UnloadPreviewLine extends ArticleRef {
  loaded: number;
  delivered: number;
  free: number;
  theoretical: number;
}

export interface UnloadDto {
  id: string;
  date: string;
  truck: WarehouseRef;
  user: PersonRef;
  keepsStockInTruck: boolean;
  validatedAt: string | null;
  hasGap: boolean;
  lines: (UnloadPreviewLine & {
    counted: number;
    gap: number;
    conditions: {
      condition: ReturnConditionCode;
      qty: number;
      lot: string | null;
      photoUrl: string | null;
    }[];
  })[];
}
