import type {
  CustomerDto,
  DriverRouteDto,
  MyObjective,
  OfflineKind,
  OfflineKindData,
  OfflineOrder,
  OfflinePayment,
  OfflineQuota,
  OfflineReason,
  OfflineSettings,
  OfflineVisit,
  OfflineWorkday,
  PlanningDay,
  ProductDto,
  TerritoryDto,
  TruckCheckLine,
  TruckStockDto,
  VisitPricingCatalog,
} from '@sellwasl/validation';
import type { StoredRow } from './types';

/**
 * Vue locale du téléphone (spec phase 23 §4.4) : les données reçues du serveur, rangées par sorte ;
 * `applyOps` y ajoute l'effet des opérations encore dans la file.
 */
export interface LocalState {
  settings: OfflineSettings | null;
  reasons: OfflineReason[];
  products: ProductDto[];
  /** Grille de prix par type de client. */
  pricing: Map<string, VisitPricingCatalog>;
  territories: TerritoryDto[];
  /** Planning par date (jour et lendemain). */
  planning: Map<string, PlanningDay>;
  customers: Map<string, CustomerDto>;
  quotas: OfflineQuota[];
  objectives: MyObjective[];
  workdays: OfflineWorkday[];
  visits: OfflineVisit[];
  orders: Map<string, OfflineOrder>;
  payments: OfflinePayment[];
  /** Tournée du livreur par date. */
  driverDays: Map<string, DriverRouteDto>;
  /** Stock du camion par article (unité de base). */
  truckStock: Map<string, TruckStockDto>;
  truckCheck: TruckCheckLine[];
  /** Disponible au dépôt par article (prévente), une indication. */
  depotStock: Map<string, number>;
}

export type RowsByKind = Partial<Record<OfflineKind, StoredRow[]>>;

const data = <K extends OfflineKind>(rows: RowsByKind, kind: K): OfflineKindData[K][] =>
  (rows[kind] ?? []).map((r) => structuredClone(r.data) as OfflineKindData[K]);

/** Construit la vue à partir des lignes reçues. */
export function loadState(rows: RowsByKind): LocalState {
  return {
    settings: data(rows, 'settings')[0] ?? null,
    reasons: data(rows, 'reason'),
    products: data(rows, 'product').sort((a, b) => a.name.localeCompare(b.name)),
    pricing: new Map(data(rows, 'pricing').map((p) => [p.customerTypeId, p.catalog])),
    territories: data(rows, 'territory'),
    planning: new Map(data(rows, 'planningDay').map((d) => [d.date, d])),
    customers: new Map(data(rows, 'customer').map((c) => [c.id, c])),
    quotas: data(rows, 'quota'),
    objectives: data(rows, 'objective'),
    workdays: data(rows, 'workday'),
    visits: data(rows, 'visit'),
    orders: new Map(data(rows, 'order').map((o) => [o.id, o])),
    payments: data(rows, 'payment'),
    driverDays: new Map(data(rows, 'driverDay').map((d) => [d.date, d])),
    truckStock: new Map(data(rows, 'truckStock').map((s) => [s.variantId, s])),
    truckCheck: data(rows, 'truckCheck')[0]?.lines ?? [],
    depotStock: new Map(data(rows, 'depotStock').map((s) => [s.variantId, s.available])),
  };
}

/** Copie indépendante, pour appliquer les effets sans toucher la vue reçue. */
export function cloneState(s: LocalState): LocalState {
  return structuredClone(s);
}

/** Journée en cours du téléphone (une seule à la fois, BR-JOU-01). */
export function openWorkday(s: LocalState) {
  return s.workdays.find((w) => w.status === 'IN_PROGRESS') ?? null;
}

/** Utilisateur du téléphone, au format des écrans. */
export function meOf(s: LocalState) {
  const m = s.settings?.me;
  return { id: m?.userId ?? '', code: m?.code ?? '', name: m?.name ?? '' };
}
