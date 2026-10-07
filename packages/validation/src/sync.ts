// Synchronisation du téléphone (docs/api.md §6-7) et écrans du vendeur (phase 15)
import { z } from 'zod';
import { frequencySchema } from './customers';
import type { PlanningDay } from './planning';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Mois au format AAAA-MM');
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/** Types d'opérations reçus en phase 15 ; les commandes et livraisons viennent ensuite. */
export const OPERATION_TYPES = [
  'workday.start',
  'workday.close',
  'visit.start',
  'visit.close_no_order',
  'customer.create',
  'payment.debt',
  'order.confirm',
  'order.update',
  'order.cancel',
  'load.receive',
  'delivery.confirm',
  'delivery.fail',
  'truck.check',
  'sale.confirm',
  'lost_demand.create',
  'receipt.reprint',
  'refusal.contest',
  'notification.read',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const syncOperationSchema = z.object({
  opId: z.uuid(),
  deviceSeq: z.number().int().min(1),
  type: z.string().min(1).max(60),
  occurredAt: z.iso.datetime({ offset: true }),
  workdayId: z.uuid().nullish(),
  settingsVersion: z.number().int().nullish(),
  payload: z.unknown(),
});
export type SyncOperationInput = z.infer<typeof syncOperationSchema>;

export const syncPushSchema = z.object({
  deviceId: z.uuid(),
  operations: z.array(syncOperationSchema).min(1).max(100),
});
export type SyncPushInput = z.infer<typeof syncPushSchema>;

/** offline : action enregistrée sans réseau (BR-JOU-04, BR-JOU-06), vue par le superviseur. */
export const workdayStartPayload = z.object({
  workdayId: z.uuid(),
  date,
  offline: z.boolean().optional(),
});
export const workdayClosePayload = z.object({
  workdayId: z.uuid(),
  offline: z.boolean().optional(),
});
export const visitStartPayload = z.object({
  visitId: z.uuid(),
  customerId: z.uuid(),
  mode: z.enum(['ON_SITE', 'PHONE']),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
});
export const visitCloseNoOrderPayload = z.object({ visitId: z.uuid(), reasonId: z.uuid() });
export const customerCreatePayload = z.object({
  customerId: z.uuid(),
  name: z.string().trim().min(1, 'Nom obligatoire').max(120),
  phone: z.string().trim().max(30).nullish(),
  address: z.string().trim().max(200).nullish(),
  customerTypeId: z.uuid(),
  latitude,
  longitude,
  frequency: frequencySchema,
});
export const paymentDebtPayload = z.object({
  paymentId: z.uuid(),
  number: z.string().min(3).max(30),
  customerId: z.uuid(),
  amount: z.number().int().positive('Le montant doit être supérieur à 0'),
});

export const orderLineInput = z.object({
  variantId: z.uuid(),
  unitId: z.uuid(),
  qty: z.number().int().min(1, 'Quantité supérieure à 0').max(100_000),
});
const orderLines = z.array(orderLineInput).min(1, 'Le panier est vide').max(200);
/** Parfum offert choisi par le vendeur, par règle de bonus (BR-CAT-15). */
const freeVariantChoices = z.record(z.uuid(), z.uuid()).optional();
/**
 * Découpage calculé par le téléphone, en unité de base (phase 23) : le serveur signale ce qui
 * diffère à la réception (APPLIED_WITH_CHANGES, BR-SYN-05).
 */
const expectedLines = z
  .array(
    z.object({
      variantId: z.uuid(),
      pendingQty: z.number().int().min(0),
      stockoutQty: z.number().int().min(0),
    }),
  )
  .max(500)
  .optional();
export const orderConfirmPayload = z.object({
  orderId: z.uuid(),
  number: z.string().min(3).max(30),
  visitId: z.uuid(),
  lines: orderLines,
  freeVariantChoices,
  expected: expectedLines,
});
export const orderUpdatePayload = z.object({
  orderId: z.uuid(),
  lines: orderLines,
  freeVariantChoices,
  expected: expectedLines,
});
export const orderCancelPayload = z.object({ orderId: z.uuid() });

export type SyncStatusValue = 'APPLIED' | 'APPLIED_WITH_CHANGES' | 'REJECTED' | 'GAP';

/** Transformation faite par le serveur à la réception (BR-SYN-05, spec phase 23 §3.3-3.4). */
export type SyncChange =
  | { kind: 'QUOTA_PENDING'; productVariantId: string; pendingQty: number }
  | { kind: 'STOCKOUT'; productVariantId: string; orderedQty: number; reservedQty: number }
  | { kind: 'QUOTA_EXCEEDED'; productVariantId: string; exceededQty: number }
  | { kind: 'TRUCK_STOCK_SHORT'; productVariantId: string; shortQty: number };

export interface SyncResult {
  opId: string;
  status: SyncStatusValue;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  /** Avec APPLIED_WITH_CHANGES : ce que le serveur a transformé. */
  changes?: SyncChange[];
}

export interface SyncPushResponse {
  results: SyncResult[];
  serverTime: string;
}

export const myTodayQuerySchema = z.object({ date: date.optional() });
export const myObjectivesQuerySchema = z.object({ month: month.optional() });

export type WorkdayStatusValue = 'NOT_STARTED' | 'IN_PROGRESS' | 'CLOSED';

export interface TodayVisit {
  id: string;
  customerId: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED';
  mode: 'ON_SITE' | 'PHONE';
  isScheduled: boolean;
  isOutOfZone: boolean;
  distanceM: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** Journée du vendeur connecté (GET /me/today). */
export interface TodayResponse {
  date: string;
  workday: {
    id: string;
    status: WorkdayStatusValue;
    startedAt: string | null;
    closedAt: string | null;
  } | null;
  /** Journée d'un autre jour restée ouverte : à clôturer avant d'en démarrer une nouvelle. */
  openWorkday: { id: string; date: string } | null;
  day: PlanningDay;
  visits: TodayVisit[];
  counters: {
    visited: number;
    planned: number;
    outOfProgram: number;
    collectedAmount: number;
    /** Commandes non annulées de la journée et leur montant (phase 16). */
    ordersCount: number;
    ordersAmount: number;
  };
  currentVisit: TodayVisit | null;
  rules: {
    outOfZoneDistanceM: number;
    P01_workOnNonWorkingDays: boolean;
    P02_outOfProgramVisits: boolean;
  };
  seller: { code: string; series: string | null; roleCode: string };
}

/** Objectif du mois d'une gamme, vu par le vendeur (BR-OBJ-04). */
export interface MyObjective {
  range: { id: string; code: string; name: string };
  month: string;
  targetAmount: number;
  realizedAmount: number;
  rate: number;
  bonusAmount: number;
  /** null : pas de plafond. */
  capPercent: number | null;
  estimatedBonus: number;
  /** Date de versement de la prime, « AAAA-MM-JJ ». */
  paymentDate: string;
}
