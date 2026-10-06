// Réception différentielle du téléphone hors connexion (phase 23, docs/offline-sync.md)
import { z } from 'zod';
import type { TicketSettingsDto, TruckCheckLine } from './cashvan';
import type { ProductDto } from './catalog';
import type { CustomerDto } from './customers';
import type { DriverRouteDto, TruckStockDto } from './delivery';
import type { OrderDto, VisitPricingCatalog } from './orders';
import type { PlanningDay } from './planning';
import type { MyObjective, SyncChange, TodayVisit, WorkdayStatusValue } from './sync';
import type { TerritoryDto } from './territories';

/** Sortes de données téléchargées par le téléphone, dans l'ordre de la réception. */
export const OFFLINE_KINDS = [
  'settings',
  'reason',
  'product',
  'pricing',
  'territory',
  'planningDay',
  'customer',
  'quota',
  'objective',
  'workday',
  'visit',
  'order',
  'payment',
  'driverDay',
  'truckStock',
  'truckCheck',
  'depotStock',
] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];

/** Rôles qui travaillent hors connexion (spec phase 23 §1). */
export const OFFLINE_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'] as const;

export interface PulledRow {
  kind: OfflineKind;
  id: string;
  data: unknown;
  deleted: boolean;
}

export interface SyncPullResponse {
  rows: PulledRow[];
  /** Sortes à vider avant d'écrire les lignes (réception complète ou sorte renvoyée en entier). */
  replace: OfflineKind[];
  /** Curseur à renvoyer à la prochaine réception ; appliqué seulement avec hasMore = false. */
  cursor: string;
  hasMore: boolean;
  /** Jeton de la page suivante, avec le même curseur. */
  page: string | null;
  /** Clé de périmètre (rôle, secteurs, camion) : si elle change, tout est relu. */
  scope: string;
  /** Le périmètre a changé : envoyer les opérations, effacer les données reçues, relire depuis 0. */
  reset: boolean;
  serverTime: string;
}

export const syncPullQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,20}$/)
    .default('0'),
  scope: z.string().max(300).optional(),
  page: z.string().max(500).optional(),
  /** Date du téléphone : planning du jour et du lendemain, quotas, objectifs du mois. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ'),
});
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

/** Paramètres et identité utiles au téléphone (sorte « settings », id « company »). */
export interface OfflineSettings {
  settingsVersion: number;
  rules: {
    outOfZoneDistanceM: number;
    P01_workOnNonWorkingDays: boolean;
    P02_outOfProgramVisits: boolean;
    P03_bonusConsumesQuota: boolean;
    P04_recalculateOnDecrease: boolean;
  };
  ticket: TicketSettingsDto;
  me: { userId: string; code: string; name: string; series: string | null; roleCode: string };
}

export interface OfflineReason {
  id: string;
  kind: string;
  /** Motif système (par exemple « REFUSED ») ; null pour un motif créé par l'entreprise. */
  systemCode: string | null;
  label: string;
  isActive: boolean;
}

export interface OfflinePricing {
  customerTypeId: string;
  catalog: VisitPricingCatalog;
}

/** Quota d'un article un jour donné, en unité de base. */
export interface OfflineQuota {
  id: string;
  date: string;
  variantId: string;
  qty: number;
}

export interface OfflineWorkday {
  id: string;
  date: string;
  status: WorkdayStatusValue;
  startedAt: string | null;
  closedAt: string | null;
}

export type OfflineVisit = TodayVisit & { date: string };

export type OfflineOrder = OrderDto & { workdayId: string | null; customerTypeId: string };

export interface OfflinePayment {
  id: string;
  number: string;
  kind: 'DELIVERY_PAYMENT' | 'DEBT_PAYMENT';
  at: string;
  workdayId: string;
  customerId: string;
  orderId: string | null;
  dueAmount: number;
  cashAmount: number;
  creditAmount: number;
}

export interface OfflineTruckCheck {
  lines: TruckCheckLine[];
}

export interface OfflineDepotStock {
  variantId: string;
  available: number;
}

/** Données de chaque sorte. */
export interface OfflineKindData {
  settings: OfflineSettings;
  reason: OfflineReason;
  product: ProductDto;
  pricing: OfflinePricing;
  territory: TerritoryDto;
  planningDay: PlanningDay;
  customer: CustomerDto;
  quota: OfflineQuota;
  objective: MyObjective;
  workday: OfflineWorkday;
  visit: OfflineVisit;
  order: OfflineOrder;
  payment: OfflinePayment;
  driverDay: DriverRouteDto;
  truckStock: TruckStockDto;
  truckCheck: OfflineTruckCheck;
  depotStock: OfflineDepotStock;
}

/** Opération reçue d'un téléphone, vue dans le journal de synchronisation (BR-SYN-07). */
export interface SyncOperationRowDto {
  id: string;
  opId: string;
  type: string;
  typeLabel: string;
  status: 'APPLIED' | 'APPLIED_WITH_CHANGES' | 'REJECTED';
  errorCode: string | null;
  errorMessage: string | null;
  changes: SyncChange[];
  occurredAt: string;
  receivedAt: string;
  user: { id: string; code: string; name: string };
  deviceId: string;
}

export const syncOperationsQuerySchema = z.object({
  status: z.enum(['APPLIED', 'APPLIED_WITH_CHANGES', 'REJECTED']).optional(),
  userId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SyncOperationsQuery = z.infer<typeof syncOperationsQuerySchema>;

/** Libellés des opérations du téléphone (journal, écran Synchronisation). */
export const OPERATION_LABELS: Record<string, string> = {
  'workday.start': 'Démarrage de la journée',
  'workday.close': 'Clôture de la journée',
  'visit.start': 'Début de visite',
  'visit.close_no_order': 'Visite sans commande',
  'customer.create': 'Nouveau client',
  'payment.debt': 'Encaissement de dette',
  'order.confirm': 'Commande',
  'order.update': 'Modification de commande',
  'order.cancel': 'Annulation de commande',
  'load.receive': 'Réception du chargement',
  'delivery.confirm': 'Livraison',
  'delivery.fail': 'Échec de livraison',
  'truck.check': 'Pointage du camion',
  'sale.confirm': 'Vente',
  'lost_demand.create': 'Demande perdue',
  'receipt.reprint': 'Réimpression',
  'refusal.contest': 'Contestation de refus',
};
