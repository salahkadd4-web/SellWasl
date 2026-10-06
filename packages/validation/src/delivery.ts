// Livraison (phase 19) : réception du chargement, livraison, échec, objectifs du livreur
import { z } from 'zod';

const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mois au format AAAA-MM');
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const amount = z.number().int().min(0).max(10_000_000_000);

export const loadReceivePayload = z.object({
  loadId: z.uuid(),
  lines: z
    .array(z.object({ variantId: z.uuid(), receivedQty: z.number().int().min(0).max(1_000_000) }))
    .max(500),
});

/** Quantités livrées (unité de la ligne) et produits ajoutés depuis le camion. */
const deliveryContent = {
  orderId: z.uuid(),
  lines: z
    .array(z.object({ lineId: z.uuid(), qty: z.number().int().min(0).max(100_000) }))
    .max(500),
  added: z
    .array(
      z.object({
        variantId: z.uuid(),
        unitId: z.uuid(),
        qty: z.number().int().min(1).max(100_000),
      }),
    )
    .max(100)
    .default([]),
};

export const deliveryPreviewSchema = z.object(deliveryContent);

export const deliveryConfirmPayload = z.object({
  deliveryId: z.uuid(),
  number: z.string().min(3).max(30),
  ...deliveryContent,
  /** Obligatoire dès qu'une quantité est refusée (BR-RET-01). */
  refusalReasonId: z.uuid().nullish(),
  cashAmount: amount,
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
});

export const deliveryFailPayload = z.object({
  deliveryId: z.uuid(),
  number: z.string().min(3).max(30),
  orderId: z.uuid(),
  reasonId: z.uuid(),
  /** Obligatoire pour un échec « refus » (BR-RET-01). */
  refusalReasonId: z.uuid().nullish(),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
});

/** Règles de l'objectif du livreur, réglées par l'admin ou le superviseur. */
export const driverObjectivesSettingsSchema = z
  .object({
    returnWeight: z.number().int().min(0).max(100),
    returnTiers: z
      .array(
        z.object({
          maxRate: z.number().min(0).max(100),
          score: z.number().int().min(0).max(100),
        }),
      )
      .min(1)
      .max(10),
    criteria: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().trim().min(1).max(60),
          weight: z.number().int().min(1).max(100),
        }),
      )
      .max(10),
  })
  .refine((s) => s.returnWeight + s.criteria.reduce((sum, c) => sum + c.weight, 0) === 100, {
    message: 'La somme des poids doit faire 100.',
  });
export type DriverObjectivesSettings = z.infer<typeof driverObjectivesSettingsSchema>;

export const DEFAULT_DRIVER_OBJECTIVES: DriverObjectivesSettings = {
  returnWeight: 100,
  returnTiers: [
    { maxRate: 5, score: 100 },
    { maxRate: 8, score: 70 },
    { maxRate: 12, score: 40 },
  ],
  criteria: [],
};

export const driverObjectivesQuerySchema = z.object({ month });
export const putDriverObjectivesSchema = z.object({
  month,
  entries: z
    .array(
      z.object({
        userId: z.uuid(),
        bonusAmount: amount,
        ratings: z.record(z.uuid(), z.number().int().min(0).max(10)),
      }),
    )
    .min(1)
    .max(200),
});

export interface DeliveryLineDto {
  lineId: string;
  kind: 'NORMAL' | 'BONUS';
  variantId: string;
  productName: string;
  variantName: string | null;
  unitId: string;
  unitName: string;
  unitBaseQty: number;
  /** Préparé, dans l'unité de la ligne : le maximum livrable. */
  preparedQty: number;
  unitPrice: number;
  /** Livré, dans l'unité de la ligne, une fois la livraison faite. */
  deliveredQty: number | null;
}

export interface DriverDeliveryDto {
  orderId: string;
  number: string;
  status: string;
  totalAmount: number;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    debtAmount: number;
    isCreditAllowed: boolean;
    creditLimitAmount: number;
  };
  lines: DeliveryLineDto[];
  delivery: { number: string; result: 'DELIVERED' | 'PARTIAL' | 'FAILED' } | null;
}

export interface RouteProgress {
  delivered: number;
  partial: number;
  failed: number;
  pending: number;
  /** Encaissé en espèces sur les livraisons, en DA. */
  collected: number;
}

export interface DriverRouteDto {
  date: string;
  workday: { id: string; status: 'IN_PROGRESS' | 'CLOSED' } | null;
  /** Chargement à recevoir (BR-PRE-05). */
  loadToReceive: {
    id: string;
    truckCode: string;
    lines: { variantId: string; productName: string; variantName: string | null; qty: number }[];
  } | null;
  route: { id: string; status: string; truckCode: string | null } | null;
  deliveries: DriverDeliveryDto[];
  progress: RouteProgress;
}

export interface TruckStockDto {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  qty: number;
  units: { id: string; name: string; baseQty: number; isBase: boolean }[];
}

export interface DeliveryPreviewDto {
  lines: {
    lineId: string | null;
    kind: 'NORMAL' | 'BONUS';
    variantId: string;
    productName: string;
    variantName: string | null;
    unitName: string;
    qty: number;
    unitPrice: number;
    amount: number;
  }[];
  dueAmount: number;
  minimumCash: number;
  debtAmount: number;
}

export interface DriverObjectiveDto {
  month: string;
  user: { id: string; code: string; name: string };
  bonusAmount: number;
  ratings: Record<string, number>;
  loaded: number;
  returned: number;
  returnRate: number | null;
  returnScore: number;
  score: number;
  estimatedBonus: number;
  paymentDate: string;
}
