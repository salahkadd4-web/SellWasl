// Dashboard, rapports, exports et analyse des retours (phase 21)
import { z } from 'zod';
import { RETURN_CONDITIONS, type ReturnConditionCode } from './stock';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const MAX_DAYS = 366;

const dayCount = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;

/** Filtres communs des rapports. */
const filters = {
  territoryId: z.uuid().optional(),
  partId: z.uuid().optional(),
  userId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  productId: z.uuid().optional(),
  driverId: z.uuid().optional(),
};

/** Filtres en plus pour les retours. */
const returnFilters = {
  ...filters,
  sellerId: z.uuid().optional(),
  lotId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  reasonId: z.uuid().optional(),
  condition: z.enum(RETURN_CONDITIONS).optional(),
};

/** Début avant fin, ${MAX_DAYS} jours au plus. */
const periodOk = (q: { from: string; to: string }) =>
  q.from <= q.to && dayCount(q.from, q.to) <= MAX_DAYS;
const PERIOD = { message: `Période invalide : début avant fin, ${MAX_DAYS} jours au plus.` };
const span = { from: date, to: date };

export const reportsQuerySchema = z.object({ ...span, ...filters }).refine(periodOk, PERIOD);
export type ReportsQuery = z.output<typeof reportsQuerySchema>;
export const dashboardQuerySchema = z
  .object({ ...span, territoryId: z.uuid().optional() })
  .refine(periodOk, PERIOD);
export const userSheetQuerySchema = z.object(span).refine(periodOk, PERIOD);
export const mapQuerySchema = z.object({ date: date.optional() });

export const EXPORT_TYPES = [
  'sales',
  'visits',
  'objectives',
  'debts',
  'settlements',
  'refusals',
  'returns',
  'resales',
  'gaps',
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
/** Exports qui exigent le module RETURNS_ANALYSIS. */
export const RETURNS_EXPORTS: readonly ExportType[] = ['refusals', 'returns', 'resales', 'gaps'];
export const exportQuerySchema = z.object({ ...span, ...returnFilters }).refine(periodOk, PERIOD);

export const RETURN_AXES = [
  'product',
  'lot',
  'supplier',
  'seller',
  'driver',
  'customer',
  'territory',
  'route',
  'reason',
  'condition',
] as const;
export type ReturnAxis = (typeof RETURN_AXES)[number];
export const RETURN_FACT_KINDS = ['REFUSAL', 'RESALE', 'RETURN', 'GAP'] as const;
export type ReturnFactKindCode = (typeof RETURN_FACT_KINDS)[number];

export const returnsQuerySchema = z.object({ ...span, ...returnFilters }).refine(periodOk, PERIOD);
export type ReturnsQuery = z.output<typeof returnsQuerySchema>;
export const returnsCrossQuerySchema = z
  .object({
    ...span,
    ...returnFilters,
    rows: z.enum(RETURN_AXES),
    cols: z.enum(RETURN_AXES),
    kind: z.enum(RETURN_FACT_KINDS).default('RETURN'),
  })
  .refine(periodOk, PERIOD)
  .refine((q) => q.rows !== q.cols, { message: 'Choisissez deux axes différents.' });
export const returnFactsQuerySchema = z
  .object({
    ...span,
    ...returnFilters,
    kind: z.enum(RETURN_FACT_KINDS).optional(),
    axis: z.enum(RETURN_AXES).optional(),
    /** Valeur de l'axe ; « none » : faits sans valeur pour cet axe. */
    value: z.string().min(1).max(60).optional(),
  })
  .refine(periodOk, PERIOD);

export const refusalContestPayload = z.object({
  deliveryId: z.uuid(),
  comment: z.string().trim().min(3, 'Expliquez la contestation.').max(500),
});
export const refusalDecisionSchema = z.object({ upheld: z.boolean() });
export const myRefusalsQuerySchema = z.object({ from: date.optional(), to: date.optional() });

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Nom obligatoire').max(120),
  phone: z.string().trim().max(30).nullish(),
  isActive: z.boolean().optional(),
});
export const lotsQuerySchema = z.object({ variantId: z.uuid() });

export interface RateDto {
  /** Pourcentage ; null sous le volume minimum. */
  rate: number | null;
  volume: number;
  insufficient: boolean;
}

export interface SupplierDto {
  /** Version de la fiche : renvoyée à la modification (conflit, api.md §1). */
  version: number;
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
}

export interface LotDto {
  id: string;
  number: string;
  expiresAt: string | null;
  receivedQty: number;
  supplier: { id: string; name: string } | null;
}

export interface DashboardDto {
  from: string;
  to: string;
  revenue: number;
  orders: number;
  visits: { planned: number; done: number };
  notVisited: number;
  lateCustomers: number;
  conversion: RateDto;
  activeSellers: number;
  activeDrivers: number;
  ordersPreparing: number;
  ordersInDelivery: number;
  deliveryFailures: number;
  lowStock: number;
  stockouts: number;
  /** Présent si le module RETURNS_ANALYSIS est actif et l'utilisateur a returns.read. */
  returns?: ReturnsSummaryDto;
}

export interface ReturnsSummaryDto {
  refusals: number;
  refusedValue: number;
  refusalRate: RateDto;
  returnedQty: number;
  returnedValue: number;
  returnRate: RateDto;
  resoldValue: number;
  netCost: number;
  gapQty: number;
  gapValue: number;
}

export interface TodayRowDto {
  user: { id: string; code: string; name: string; role: string };
  workday: 'NOT_STARTED' | 'IN_PROGRESS' | 'CLOSED';
  visited: number;
  planned: number;
  outOfZone: number;
  byPhone: number;
  orders: number;
  revenue: number;
  lastPosition: { latitude: number; longitude: number; at: string } | null;
  lastSyncAt: string | null;
  battery: number | null;
  pendingOps: number;
  online: boolean;
}

export interface SupervisorMapDto {
  date: string;
  parts: { id: string; name: string; territory: string; geojson: unknown }[];
  customers: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    visited: boolean;
    userId: string;
  }[];
  positions: { userId: string; name: string; latitude: number; longitude: number; at: string }[];
}

export interface UserSheetDto {
  user: { id: string; code: string; name: string; role: string };
  from: string;
  to: string;
  workdays: number;
  visits: number;
  orders: number;
  revenue: number;
  conversion: RateDto;
  deliveries: { delivered: number; partial: number; failed: number };
  collected: number;
  returns?: ReturnsSummaryDto;
}

export interface KeyLabel {
  key: string | null;
  label: string;
}

export interface CommercialReportDto {
  byDay: { date: string; orders: number; revenue: number }[];
  byProduct: (KeyLabel & { qty: number; revenue: number })[];
  byCustomer: (KeyLabel & { orders: number; revenue: number })[];
}

export interface PresalesReportDto {
  bySeller: (KeyLabel & { visits: number; orders: number; conversion: RateDto; revenue: number })[];
  byTerritory: (KeyLabel & {
    visits: number;
    orders: number;
    conversion: RateDto;
    revenue: number;
  })[];
}

export interface DeliveryReportDto {
  byDriver: (KeyLabel & {
    deliveries: number;
    delivered: number;
    partial: number;
    failed: number;
    /** Jours moyens entre la confirmation de la commande et la livraison. */
    averageDelayDays: number | null;
  })[];
  failuresByReason: (KeyLabel & { count: number })[];
}

export interface LostSalesReportDto {
  byProduct: (KeyLabel & { lostSales: number; lostDemand: number })[];
  byCustomer: (KeyLabel & { lostSales: number; lostDemand: number })[];
  bySeller: (KeyLabel & { lostSales: number; lostDemand: number })[];
}

export interface ReturnsAxisRowDto extends KeyLabel {
  refusals: number;
  refusedQty: number;
  refusedValue: number;
  returnedQty: number;
  returnedValue: number;
  resoldQty: number;
  resoldValue: number;
  gapQty: number;
  gapValue: number;
  netCost: number;
  /** Taux principal de l'axe (voir `rateLabel`). */
  rate: RateDto;
  /** Part du défectueux dans le retourné (produit, lot, fournisseur). */
  defectiveShare?: RateDto;
}

export interface ReturnsAxisDto {
  axis: ReturnAxis;
  rateLabel: string;
  rows: ReturnsAxisRowDto[];
}

export interface ReturnsCrossDto {
  rows: KeyLabel[];
  cols: KeyLabel[];
  cells: { row: string | null; col: string | null; qty: number; value: number }[];
}

export interface ReturnFactDto {
  id: string;
  kind: ReturnFactKindCode;
  date: string;
  qty: number;
  value: number;
  condition: ReturnConditionCode | null;
  article: string;
  lot: string | null;
  supplier: string | null;
  seller: string | null;
  driver: string | null;
  customer: string | null;
  territory: string | null;
  reason: string | null;
  order: { id: string; number: string } | null;
  delivery: { id: string; number: string } | null;
  unloadId: string | null;
}

export type ContestStatusCode = 'NONE' | 'CONTESTED' | 'UPHELD' | 'REJECTED';

export interface RefusalDto {
  deliveryId: string;
  number: string;
  date: string;
  result: 'PARTIAL' | 'FAILED';
  order: { id: string; number: string };
  customer: { id: string; name: string };
  seller: string;
  driver: string;
  reason: string | null;
  refusedValue: number;
  lines: { article: string; qty: number }[];
  contestStatus: ContestStatusCode;
  contestComment: string | null;
  contestedAt: string | null;
  decidedAt: string | null;
}
