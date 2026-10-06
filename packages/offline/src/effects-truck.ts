import type { OfflineOrder, TruckStockDto } from '@sellwasl/validation';
import { type Effect, num, str } from './effect-kit';
import { type LocalState, meOf, openWorkday } from './local-state';
import { buildOrder } from './order-build';
import type { OutboxOp } from './types';

/** Ligne du stock du camion d'un article, créée à partir du catalogue si besoin. */
function truckRow(s: LocalState, variantId: string): TruckStockDto | null {
  const existing = s.truckStock.get(variantId);
  if (existing) return existing;
  const product = s.products.find((p) => p.variants.some((v) => v.id === variantId));
  const variant = product?.variants.find((v) => v.id === variantId);
  if (!product || !variant) return null;
  const row: TruckStockDto = {
    variantId,
    productId: product.id,
    productName: product.name,
    variantName: variant.isDefault ? null : variant.name,
    qty: 0,
    units: product.units
      .filter((u) => u.isActive)
      .map((u) => ({ id: u.id, name: u.name, baseQty: u.baseQty, isBase: u.isBase })),
  };
  s.truckStock.set(variantId, row);
  return row;
}

/** Sortie du camion, jamais en dessous de zéro (le serveur enregistre l'éventuel écart). */
export function takeFromTruck(s: LocalState, variantId: string, qty: number): void {
  const row = s.truckStock.get(variantId);
  if (row) row.qty = Math.max(0, row.qty - qty);
}

/** Pointage : le camion contient ce qui a été compté (BR-CV-02, BR-PRE-05). */
function setTruck(s: LocalState, counted: { variantId: string; qty: number }[]): void {
  for (const c of counted) {
    const row = truckRow(s, c.variantId);
    if (row) row.qty = c.qty;
  }
  s.truckCheck = s.truckCheck.map((l) => {
    const c = counted.find((x) => x.variantId === l.variantId);
    return { ...l, inTruck: c ? c.qty : l.inTruck, toReceive: 0 };
  });
}

/** Effets des opérations du camion : vente cash van, pointage, réception du chargement. */
export const TRUCK_EFFECTS: Partial<Record<OutboxOp['type'], Effect>> = {
  // Vente : livrée et payée sur place ; le crédit va à la dette ; le camion se vide (BR-CV-03 à 05)
  'sale.confirm': (s, p, op) => {
    const id = str(p.orderId)!;
    const visit = s.visits.find((v) => v.id === str(p.visitId));
    const customer = visit ? s.customers.get(visit.customerId) : undefined;
    const workday = openWorkday(s);
    if (!visit || !customer || !workday || s.orders.has(id)) return;
    const built = buildOrder(s, {
      customerTypeId: customer.customerType.id,
      date: visit.date,
      lines: p.lines as never,
      freeVariantChoices: p.freeVariantChoices as Record<string, string> | undefined,
      cashVan: true,
    });
    // Hors connexion, la vente est entière même au-delà du quota (spec §3.4) : lignes normales
    const lines = built.lines.map((l) =>
      l.kind === 'PENDING'
        ? { ...l, kind: 'NORMAL' as const, pendingStatus: null, reservedQty: l.orderedQty }
        : l,
    );
    const due = lines
      .filter((l) => l.kind === 'NORMAL')
      .reduce((n, l) => n + l.unitPrice * l.enteredQty, 0);
    const cash = Math.min(num(p.cashAmount) ?? 0, due);
    const order: OfflineOrder = {
      id,
      number: str(p.number) ?? '',
      status: 'DELIVERED',
      source: 'CASH_VAN',
      orderDate: visit.date,
      deliveryDate: visit.date,
      totalAmount: due,
      visitId: visit.id,
      customer: { id: customer.id, name: customer.name, code: customer.code },
      seller: meOf(s),
      confirmedAt: op.occurredAt,
      lines,
      workdayId: workday.id,
      customerTypeId: customer.customerType.id,
    };
    s.orders.set(id, order);
    for (const l of lines) takeFromTruck(s, l.variantId, l.orderedQty);
    s.payments.push({
      id: `pay-${id}`,
      number: order.number,
      kind: 'DELIVERY_PAYMENT',
      at: op.occurredAt,
      workdayId: workday.id,
      customerId: customer.id,
      orderId: id,
      dueAmount: due,
      cashAmount: cash,
      creditAmount: due - cash,
    });
    customer.debtAmount += due - cash;
    visit.status = 'COMPLETED';
    visit.endedAt = op.occurredAt;
  },

  'truck.check': (s, p) => {
    const lines = (p.lines as { variantId: string; countedQty: number }[] | undefined) ?? [];
    setTruck(
      s,
      lines.map((l) => ({ variantId: l.variantId, qty: l.countedQty })),
    );
  },

  // Livreur : le chargement reçu s'ajoute au camion
  'load.receive': (s, p) => {
    const lines = (p.lines as { variantId: string; receivedQty: number }[] | undefined) ?? [];
    for (const l of lines) {
      const row = truckRow(s, l.variantId);
      if (row) row.qty += l.receivedQty;
    }
    s.truckCheck = s.truckCheck.map((l) => ({ ...l, toReceive: 0 }));
    for (const day of s.driverDays.values())
      if (day.loadToReceive?.id === str(p.loadId)) day.loadToReceive = null;
  },
};
