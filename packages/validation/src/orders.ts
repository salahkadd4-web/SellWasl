// Commandes (phase 16) : catalogue de visite, commandes, quotas, lignes en attente, objectifs, journées
import { z } from 'zod';
import type { MyObjective } from './sync';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mois au format AAAA-MM');
const amount = z.number().int().min(0).max(10_000_000_000);

export const ORDER_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'LOCKED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'FAILED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Grille de prix d'un type de client, au format de `priceCart` (packages/business-rules). */
export interface VisitPricingCatalog {
  units: readonly { id: string; productId: string; baseQty: number }[];
  variants: readonly { id: string; productId: string; isActive: boolean }[];
  prices: readonly { productId: string; variantId: string | null; unitId: string; price: number }[];
  tiers: readonly {
    productId: string;
    variantId: string | null;
    unitId: string;
    minQty: number;
    unitPrice: number;
    thresholdScope: 'ALL_VARIANTS' | 'PER_VARIANT';
  }[];
  bonusRules: readonly {
    id: string;
    name: string;
    buyProductId: string;
    buyVariantId: string | null;
    buyUnitId: string;
    buyQty: number;
    freeProductId: string;
    freeVariantId: string | null;
    freeUnitId: string;
    freeQty: number;
    freeVariantMode: 'FIXED' | 'SELLER_CHOICE' | 'AUTO_MOST_STOCK';
    validFrom: string;
    validTo: string | null;
    customerTypeIds: readonly string[];
  }[];
}

/** Catalogue proposable à un client pendant la visite (BR-CMD-06, BR-CAT-11). */
export interface VisitCatalog {
  customerId: string;
  customerTypeId: string;
  date: string;
  catalog: VisitPricingCatalog;
  products: {
    id: string;
    name: string;
    reference: string;
    range: { id: string; name: string };
    category: { id: string; name: string } | null;
    hasFlavors: boolean;
    units: { id: string; name: string; baseQty: number }[];
    variants: {
      id: string;
      name: string;
      /** Reste du quota du jour en unité de base ; null : pas de quota. */
      quotaRemaining: number | null;
      quotaReached: boolean;
    }[];
  }[];
  rules: { P03_bonusConsumesQuota: boolean };
  /** Vendeur cash van : stock du camion par article, en unité de base (BR-CV-03). */
  truckStock?: Record<string, number>;
}

export type OrderLineKindValue = 'NORMAL' | 'PENDING' | 'BONUS';

export interface OrderLineDto {
  id: string;
  kind: OrderLineKindValue;
  pendingStatus: 'TO_PROCESS' | 'ACCEPTED' | 'REFUSED' | null;
  productId: string;
  variantId: string;
  unitId: string;
  productName: string;
  variantName: string | null;
  unitName: string;
  enteredQty: number;
  orderedQty: number;
  reservedQty: number;
  unitPrice: number;
  lineAmount: number;
  isStockout: boolean;
}

export interface OrderDto {
  id: string;
  number: string;
  status: OrderStatus;
  source: string;
  orderDate: string;
  deliveryDate: string | null;
  totalAmount: number;
  visitId: string | null;
  customer: { id: string; name: string; code: string | null };
  seller: { id: string; code: string; name: string };
  lines: OrderLineDto[];
  confirmedAt: string | null;
}

export const myOrdersQuerySchema = z.object({ date });

// --- Quotas du jour (UC-55) ---
export const quotasQuerySchema = z.object({ date });
export const putQuotasSchema = z.object({
  date,
  entries: z
    .array(
      z.object({
        userId: z.uuid(),
        productVariantId: z.uuid(),
        unitId: z.uuid(),
        /** 0 : supprime le quota. */
        qty: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(2000),
});
export interface QuotaDto {
  id: string;
  date: string;
  user: { id: string; code: string; name: string };
  productVariantId: string;
  productName: string;
  variantName: string | null;
  /** En unité de base. */
  qty: number;
  enteredQty: number;
  enteredUnit: { id: string; name: string };
  /** Quantités normales confirmées ce jour-là, en unité de base. */
  consumedQty: number;
}

// --- Lignes en attente (UC-60) ---
export const pendingLinesQuerySchema = z.object({ date: date.optional() });
export const decidePendingSchema = z.object({
  lineIds: z.array(z.uuid()).min(1).max(200),
  decision: z.enum(['ACCEPT', 'REFUSE']),
});
export interface PendingLineDto {
  id: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  seller: { id: string; code: string; name: string };
  customer: { id: string; name: string };
  productName: string;
  variantName: string | null;
  unitName: string;
  qty: number;
  unitPrice: number;
  /** Stock disponible au dépôt, en unité de base. */
  availableStock: number;
}

// --- Objectifs du mois (UC-56) ---
export const objectivesQuerySchema = z.object({ month });
export const putObjectivesSchema = z.object({
  month,
  entries: z
    .array(
      z.object({
        userId: z.uuid(),
        rangeId: z.uuid(),
        targetAmount: amount,
        bonusAmount: amount,
        /** Ignoré : le plafond est celui de l'entreprise (BR-OBJ-01). */
        capPercent: z.number().int().min(100).max(500).optional(),
      }),
    )
    .min(1)
    .max(500),
});
/** null : pas de plafond. */
export const objectiveCapSchema = z.object({
  capPercent: z.number().int().min(100).max(500).nullable(),
});

export const objectivePaymentSchema = z.object({
  delayMonths: z.union([z.literal(0), z.literal(1)]),
});

export interface ObjectiveDto extends MyObjective {
  id: string;
  user: { id: string; code: string; name: string };
}

// --- Commandes (historique) ---
export const ordersQuerySchema = z.object({
  date: date.optional(),
  sellerId: z.uuid().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
});

// --- Journées (UC-57, UC-58, UC-64) ---
export const workdaysQuerySchema = z.object({ date });
export const workdayReasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif obligatoire').max(200),
});
export interface WorkdayDto {
  /** null : journée pas encore démarrée ce jour-là. */
  id: string | null;
  date: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'CLOSED';
  user: { id: string; code: string; name: string; roleName: string };
  startedAt: string | null;
  closedAt: string | null;
  isForceClosed: boolean;
  reopenCount: number;
  visits: { done: number; planned: number; outOfZone: number; byPhone: number };
  ordersCount: number;
  ordersAmount: number;
  collectedAmount: number;
}
