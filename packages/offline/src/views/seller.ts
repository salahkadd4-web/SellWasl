import { visitCounters } from '@sellwasl/business-rules';
import type {
  CustomerDto,
  MyObjective,
  OrderDto,
  PlanningDay,
  TodayResponse,
  TodayVisit,
  VisitCatalog,
} from '@sellwasl/validation';
import type { LocalState } from '../local-state';
import { consumedQuota, OfflineError, quotaRemaining } from '../order-build';

const toVisit = ({ date: _date, ...v }: TodayVisit & { date: string }): TodayVisit => v;

/** Planning du jour, avec la dette à jour des clients (encaissements en file). */
function dayOf(s: LocalState, date: string): PlanningDay {
  const day = s.planning.get(date);
  const me = s.settings?.me;
  if (!day)
    return {
      date,
      status: 'WORKING',
      holiday: null,
      seller: { id: me?.userId ?? '', code: me?.code ?? '', name: me?.name ?? '' },
      territory: null,
      part: null,
      customers: [],
    };
  return {
    ...day,
    customers: day.customers.map((c) => ({
      ...c,
      debtAmount: s.customers.get(c.id)?.debtAmount ?? c.debtAmount,
    })),
  };
}

/** Journée du vendeur, comme GET /me/today (`WorkdayService.today`). */
export function todayView(s: LocalState, date: string): TodayResponse {
  const workday = s.workdays.find((w) => w.date === date) ?? null;
  const stale = s.workdays.find((w) => w.status === 'IN_PROGRESS' && w.date !== date) ?? null;
  const day = dayOf(s, date);
  const visits = s.visits
    .filter((v) => v.date === date)
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  const current = s.visits.find((v) => v.status === 'IN_PROGRESS') ?? null;
  const orders = workday
    ? [...s.orders.values()].filter((o) => o.workdayId === workday.id && o.status !== 'CANCELLED')
    : [];
  const rules = s.settings?.rules;
  return {
    date,
    workday: workday && {
      id: workday.id,
      status: workday.status,
      startedAt: workday.startedAt,
      closedAt: workday.closedAt,
    },
    openWorkday: stale && { id: stale.id, date: stale.date },
    day,
    visits: visits.map(toVisit),
    counters: {
      ...visitCounters(
        day.customers.map((c) => c.id),
        visits,
      ),
      collectedAmount: workday
        ? s.payments.filter((p) => p.workdayId === workday.id).reduce((n, p) => n + p.cashAmount, 0)
        : 0,
      ordersCount: orders.length,
      ordersAmount: orders.reduce((n, o) => n + o.totalAmount, 0),
    },
    currentVisit: current && toVisit(current),
    rules: {
      outOfZoneDistanceM: rules?.outOfZoneDistanceM ?? 0,
      P01_workOnNonWorkingDays: rules?.P01_workOnNonWorkingDays ?? false,
      P02_outOfProgramVisits: rules?.P02_outOfProgramVisits ?? false,
    },
    seller: {
      code: s.settings?.me.code ?? '',
      series: s.settings?.me.series ?? null,
      roleCode: s.settings?.me.roleCode ?? '',
    },
  };
}

/**
 * Catalogue proposable au client pendant la visite, comme GET /me/visit-catalog
 * (`VisitCatalogService.forCustomer`, BR-CMD-06) : grille du type du client, articles en stock
 * (camion en cash van, disponible connu du dépôt en prévente), quota restant.
 */
export function visitCatalogView(s: LocalState, customerId: string, date: string): VisitCatalog {
  const customer = s.customers.get(customerId);
  if (!customer) throw new OfflineError('Client introuvable sur ce téléphone : synchronisez.');
  const catalog = s.pricing.get(customer.customerType.id);
  if (!catalog) throw new OfflineError('Grille de prix absente : synchronisez le téléphone.');
  const cashVan = s.settings?.me.roleCode === 'VENDEUR_CASH_VAN';
  const available = cashVan
    ? new Map([...s.truckStock.values()].filter((t) => t.qty > 0).map((t) => [t.variantId, t.qty]))
    : s.depotStock;
  const P03 = s.settings?.rules.P03_bonusConsumesQuota ?? false;
  const consumed = consumedQuota(s, date, P03);
  const priced = (productId: string, variantId: string) =>
    catalog.prices.some(
      (p) => p.productId === productId && (p.variantId === variantId || p.variantId === null),
    );
  const pricedUnit = (productId: string, unitId: string) =>
    catalog.prices.some((p) => p.productId === productId && p.unitId === unitId);

  return {
    customerId,
    customerTypeId: customer.customerType.id,
    date,
    catalog,
    products: s.products
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        reference: p.reference,
        range: { id: p.range.id, name: p.range.name },
        category: p.category,
        hasFlavors: p.variants.some((v) => !v.isDefault),
        units: p.units
          .filter((u) => u.isActive && pricedUnit(p.id, u.id))
          .sort((a, b) => a.baseQty - b.baseQty)
          .map((u) => ({ id: u.id, name: u.name, baseQty: u.baseQty })),
        variants: p.variants
          .filter((v) => v.isActive && priced(p.id, v.id) && (available.get(v.id) ?? 0) > 0)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((v) => {
            const left = quotaRemaining(s, date, v.id, consumed);
            const remaining = left === null ? null : Math.max(0, left);
            return {
              id: v.id,
              name: v.isDefault ? p.name : v.name,
              quotaRemaining: remaining,
              quotaReached: remaining === 0,
            };
          }),
      }))
      .filter((p) => p.variants.length > 0 && p.units.length > 0),
    rules: { P03_bonusConsumesQuota: P03 },
    ...(cashVan ? { truckStock: Object.fromEntries(available) } : {}),
  };
}

/** Clients du périmètre, par nom (liste et carte du vendeur). */
export function customersView(s: LocalState): CustomerDto[] {
  return [...s.customers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function customerView(s: LocalState, id: string): CustomerDto | null {
  return s.customers.get(id) ?? null;
}

/** Commandes et ventes du vendeur d'un jour, les plus récentes d'abord (GET /me/orders). */
export function ordersView(s: LocalState, date: string): OrderDto[] {
  return [...s.orders.values()]
    .filter((o) => o.orderDate === date)
    .sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''));
}

/** Objectifs du mois, tels que reçus (le réalisé suit après la synchronisation). */
export function objectivesView(s: LocalState): MyObjective[] {
  return s.objectives;
}
