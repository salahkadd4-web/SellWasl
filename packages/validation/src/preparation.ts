// Préparation des tournées (phase 18) : lancement, préparation, chargement
import { z } from 'zod';
import type { RouteProgress } from './delivery';
import type { WarehouseRef } from './stock';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

export const routesQuerySchema = z.object({ date });
export const launchRouteSchema = z.object({ date, driverId: z.uuid() });
export const prepareRouteSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.uuid(), preparedQty: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(2000)
    .refine((lines) => new Set(lines.map((l) => l.lineId)).size === lines.length, {
      message: "Une ligne ne peut figurer qu'une fois.",
    }),
});

export type LaunchBlockerCode =
  'WORKDAY_IN_PROGRESS' | 'PENDING_SYNC' | 'PENDING_LINES' | 'NO_DRIVER' | 'NO_TRUCK';

export const LAUNCH_BLOCKER_LABELS: Record<LaunchBlockerCode, string> = {
  WORKDAY_IN_PROGRESS: 'Une journée de vendeur de ces secteurs est encore en cours.',
  PENDING_SYNC: 'Un téléphone de vendeur a des opérations pas encore envoyées.',
  PENDING_LINES: 'Des lignes en attente ne sont pas traitées.',
  NO_DRIVER: "Un secteur n'a pas de livreur.",
  NO_TRUCK: "Le livreur n'a pas de camion.",
};

export type RouteStatusCode =
  'DRAFT' | 'PREPARING' | 'READY' | 'LOADED' | 'OUT_FOR_DELIVERY' | 'CLOSED';

interface PersonRef {
  id: string;
  code: string;
  name: string;
}

/** Une tournée lancée, ou un regroupement de commandes à lancer (`routeId` null). */
export interface RouteCandidateDto {
  routeId: string | null;
  status: RouteStatusCode;
  deliveryDate: string;
  driver: PersonRef | null;
  truck: WarehouseRef | null;
  territories: { id: string; code: string; name: string }[];
  ordersCount: number;
  totalAmount: number;
  /** Lignes dont la réservation ne couvre pas la quantité commandée. */
  stockouts: number;
  blockers: LaunchBlockerCode[];
  /** Avancement d'une tournée lancée (phase 19). */
  progress?: RouteProgress;
}

export interface RouteSummaryDto {
  id: string;
  status: RouteStatusCode;
  deliveryDate: string;
  driver: PersonRef;
  truck: WarehouseRef | null;
  ordersCount: number;
}

interface ArticleRef {
  variantId: string;
  productName: string;
  variantName: string | null;
}

export interface PreparationLineDto extends ArticleRef {
  lineId: string;
  kind: 'NORMAL' | 'BONUS';
  unitName: string;
  unitBaseQty: number;
  /** Quantité commandée, dans l'unité de la ligne. */
  enteredQty: number;
  /** Réservé au dépôt, en unité de base. */
  reservedQty: number;
  /** Préparé, dans l'unité de la ligne, s'il l'a déjà été. */
  preparedQty: number | null;
  defaultPrepared: number;
}

export interface RoutePreparationDto {
  route: RouteSummaryDto;
  /** Liste de chargement : total par article, en unité de base. */
  items: (ArticleRef & { orderedBase: number; reservedBase: number; available: number })[];
  orders: {
    orderId: string;
    number: string;
    customerName: string;
    lines: PreparationLineDto[];
  }[];
}

export interface PrepareResult {
  orders: { orderId: string; number: string; totalAmount: number }[];
}
