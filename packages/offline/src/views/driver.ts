import { minimumCash, type PricingCatalog, repriceOrder } from '@sellwasl/business-rules';
import type {
  DeliveryPreviewDto,
  DriverDeliveryDto,
  DriverRouteDto,
  RouteProgress,
} from '@sellwasl/validation';
import type { LocalState } from '../local-state';
import { OfflineError } from '../order-build';

export interface DeliveryInput {
  orderId: string;
  /** Quantité livrée de chaque ligne normale, dans son unité. */
  lines: { lineId: string; qty: number }[];
  /** Produits ajoutés depuis le camion. */
  added: { variantId: string; unitId: string; qty: number }[];
}

/** Livraison d'une commande de la tournée, avec son jour. */
export function findDelivery(
  s: LocalState,
  orderId: string,
): { day: DriverRouteDto; delivery: DriverDeliveryDto } | null {
  for (const day of s.driverDays.values()) {
    const delivery = day.deliveries.find((d) => d.orderId === orderId);
    if (delivery) return { day, delivery };
  }
  return null;
}

/**
 * Livraison calculée comme sur le serveur (`DeliveryService.compute`, BR-CAT-10, BR-PAY-03) :
 * prix recalculés si l'entreprise le veut et qu'une quantité baisse (P-04), produits ajoutés,
 * bonus plafonnés au préparé, minimum à encaisser selon le plafond de crédit.
 */
export function computeDelivery(s: LocalState, input: DeliveryInput) {
  const found = findDelivery(s, input.orderId);
  if (!found) throw new OfflineError('Commande absente de la tournée : synchronisez.');
  const { delivery } = found;
  const normals = delivery.lines.filter((l) => l.kind === 'NORMAL');
  const bonuses = delivery.lines.filter((l) => l.kind === 'BONUS');
  const delivered = new Map(input.lines.map((l) => [l.lineId, l.qty]));
  if (normals.some((l) => !delivered.has(l.lineId)))
    throw new OfflineError('Indiquez la quantité livrée de chaque ligne.');
  for (const l of normals)
    if (delivered.get(l.lineId)! > l.preparedQty)
      throw new OfflineError(`Livré au-delà du préparé : ${l.productName}.`);

  const decreased = normals.some((l) => delivered.get(l.lineId)! < l.preparedQty);
  const recalculate = (s.settings?.rules.P04_recalculateOnDecrease ?? false) && decreased;
  const catalog = s.pricing.get(delivery.customerTypeId) as PricingCatalog | undefined;
  if (!catalog && (recalculate || input.added.length > 0))
    throw new OfflineError('Grille de prix absente : synchronisez le téléphone.');
  const priced = repriceOrder(
    catalog ?? { units: [], variants: [], prices: [], tiers: [], bonusRules: [] },
    { customerTypeId: delivery.customerTypeId, date: delivery.orderDate },
    normals.map((l) => ({
      id: l.lineId,
      variantId: l.variantId,
      unitId: l.unitId,
      unitPrice: l.unitPrice,
      qty: delivered.get(l.lineId)!,
    })),
    bonuses.map((b) => ({
      id: b.lineId,
      bonusRuleId: b.bonusRuleId,
      variantId: b.variantId,
      maxQty: b.preparedQty,
    })),
    input.added,
    recalculate,
  );
  const addedTo = (variantId: string) =>
    input.added.filter((a) => a.variantId === variantId).reduce((n, a) => n + a.qty, 0);
  const lines = [
    ...normals.map((l) => ({
      line: l,
      qty: delivered.get(l.lineId)! + addedTo(l.variantId),
      refused: Math.max(0, l.preparedQty - delivered.get(l.lineId)!),
      unitPrice: priced.prices.get(l.lineId)!,
    })),
    ...bonuses.map((b) => ({
      line: b,
      qty: priced.bonus.get(b.lineId)!,
      refused: 0,
      unitPrice: 0,
    })),
  ];
  const due =
    lines.filter((l) => l.line.kind === 'NORMAL').reduce((n, l) => n + l.unitPrice * l.qty, 0) +
    priced.added.reduce((n, a) => n + a.unitPrice * a.qty, 0);
  const customer = s.customers.get(delivery.customer.id);
  const debt = customer?.debtAmount ?? delivery.customer.debtAmount;
  return {
    ...found,
    lines,
    fresh: priced.added,
    due,
    debt,
    minimum: minimumCash({
      due,
      isCreditAllowed: customer?.isCreditAllowed ?? delivery.customer.isCreditAllowed,
      creditLimit: customer?.creditLimitAmount ?? delivery.customer.creditLimitAmount,
      debt,
    }),
  };
}

/** Aperçu d'une livraison avant confirmation, comme POST /me/deliveries/preview. */
export function deliveryPreviewView(s: LocalState, input: DeliveryInput): DeliveryPreviewDto {
  const c = computeDelivery(s, input);
  const productOf = (variantId: string) =>
    s.products.find((p) => p.variants.some((v) => v.id === variantId));
  return {
    lines: [
      ...c.lines.map((l) => ({
        lineId: l.line.lineId,
        kind: l.line.kind,
        variantId: l.line.variantId,
        productName: l.line.productName,
        variantName: l.line.variantName,
        unitName: l.line.unitName,
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: l.unitPrice * l.qty,
      })),
      ...c.fresh.map((f) => {
        const product = productOf(f.variantId);
        const variant = product?.variants.find((v) => v.id === f.variantId);
        return {
          lineId: null,
          kind: 'NORMAL' as const,
          variantId: f.variantId,
          productName: product?.name ?? '',
          variantName: variant && !variant.isDefault ? variant.name : null,
          unitName: product?.units.find((u) => u.id === f.unitId)?.name ?? '',
          qty: f.qty,
          unitPrice: f.unitPrice,
          amount: f.unitPrice * f.qty,
        };
      }),
    ],
    dueAmount: c.due,
    minimumCash: c.minimum,
    debtAmount: c.debt,
  };
}

/** Avancement de la tournée : livrées, partielles, échecs, à faire, encaissé. */
function progressOf(s: LocalState, day: DriverRouteDto): RouteProgress {
  const count = (result: string) =>
    day.deliveries.filter((d) => d.delivery?.result === result).length;
  const orders = new Set(day.deliveries.map((d) => d.orderId));
  return {
    delivered: count('DELIVERED'),
    partial: count('PARTIAL'),
    failed: count('FAILED'),
    pending: day.deliveries.filter((d) => !d.delivery).length,
    collected: s.payments
      .filter((p) => p.kind === 'DELIVERY_PAYMENT' && p.orderId && orders.has(p.orderId))
      .reduce((n, p) => n + p.cashAmount, 0),
  };
}

/** Tournée du jour du livreur, comme GET /me/route (la plus récente si le jour manque). */
export function driverRouteView(s: LocalState, date: string): DriverRouteDto {
  const day = s.driverDays.get(date) ??
    [...s.driverDays.values()].sort((a, b) => b.date.localeCompare(a.date))[0] ?? {
      date,
      workday: null,
      loadToReceive: null,
      route: null,
      deliveries: [],
      progress: { delivered: 0, partial: 0, failed: 0, pending: 0, collected: 0 },
    };
  const workday =
    s.workdays.find((w) => w.status === 'IN_PROGRESS') ??
    s.workdays.find((w) => w.date === day.date);
  return {
    ...day,
    workday: workday
      ? { id: workday.id, status: workday.status === 'CLOSED' ? 'CLOSED' : 'IN_PROGRESS' }
      : day.workday,
    progress: progressOf(s, day),
  };
}
