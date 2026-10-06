import { daySummary } from '@sellwasl/business-rules';
import type {
  DaySummaryDto,
  ReceiptPrintDto,
  TruckCheckLine,
  TruckStockDto,
} from '@sellwasl/validation';
import type { LocalState } from '../local-state';

/** Stock du camion, comme GET /me/truck-stock. */
export function truckStockView(s: LocalState): TruckStockDto[] {
  return [...s.truckStock.values()]
    .filter((t) => t.qty > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

/** Lignes à pointer (stock du camion et chargement à recevoir), comme GET /me/truck-check. */
export function truckCheckView(s: LocalState): TruckCheckLine[] {
  return s.truckCheck;
}

/** Récapitulatif de la journée (BR-PAY-07), comme GET /me/day-summary. */
export function daySummaryView(s: LocalState, date: string): DaySummaryDto {
  const workday = s.workdays.find((w) => w.date === date);
  const me = s.settings?.me;
  return {
    date,
    user: { id: me?.userId ?? '', code: me?.code ?? '', name: me?.name ?? '' },
    ...daySummary(workday ? s.payments.filter((p) => p.workdayId === workday.id) : []),
  };
}

/**
 * Bons du jour (BR-IMP-02 à 05), comme GET /me/receipts : vente cash van, livraison, reçu de
 * dette. La dette après le bon est celle du client à jour.
 */
export function receiptsView(s: LocalState, date: string): ReceiptPrintDto[] {
  const days = new Set(s.workdays.filter((w) => w.date === date).map((w) => w.id));
  const user = s.settings?.me.name ?? '';
  return s.payments
    .filter((p) => days.has(p.workdayId))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((p) => {
      const order = p.orderId ? s.orders.get(p.orderId) : undefined;
      const customer = s.customers.get(p.customerId);
      const delivery = deliveryOf(s, p.orderId);
      const lines: ReceiptPrintDto['lines'] = order
        ? order.lines
            .filter((l) => l.kind !== 'PENDING')
            .map((l) => {
              const free = l.kind === 'BONUS';
              return {
                label: l.variantName ? `${l.productName} ${l.variantName}` : l.productName,
                unitName: l.unitName,
                qty: l.enteredQty,
                unitPrice: free ? 0 : l.unitPrice,
                amount: free ? 0 : l.unitPrice * l.enteredQty,
                free,
              };
            })
        : delivery
          ? delivery.lines
              .filter((l) => (l.deliveredQty ?? 0) > 0)
              .map((l) => {
                const free = l.kind === 'BONUS';
                const qty = l.deliveredQty ?? 0;
                return {
                  label: l.variantName ? `${l.productName} ${l.variantName}` : l.productName,
                  unitName: l.unitName,
                  qty,
                  unitPrice: free ? 0 : l.unitPrice,
                  amount: free ? 0 : l.unitPrice * qty,
                  free,
                };
              })
          : [];
      return {
        number: p.number,
        kind:
          p.kind === 'DEBT_PAYMENT' ? 'DEBT' : order?.source === 'CASH_VAN' ? 'SALE' : 'DELIVERY',
        at: p.at,
        user,
        customer: {
          name: customer?.name ?? delivery?.customer.name ?? '',
          address: customer?.address ?? delivery?.customer.address ?? null,
        },
        lines,
        total: p.dueAmount,
        paid: p.cashAmount,
        credit: p.creditAmount,
        debtAfter: customer?.debtAmount ?? delivery?.customer.debtAmount ?? 0,
        reprints: 0,
      };
    });
}

/** Livraison d'une commande de la tournée du livreur. */
function deliveryOf(s: LocalState, orderId: string | null) {
  if (!orderId) return undefined;
  for (const day of s.driverDays.values()) {
    const d = day.deliveries.find((x) => x.orderId === orderId);
    if (d) return d;
  }
  return undefined;
}

/** Bon d'un numéro, quel que soit son jour (impression juste après l'action, réimpression). */
export function receiptByNumber(s: LocalState, number: string): ReceiptPrintDto | null {
  for (const date of new Set(s.workdays.map((w) => w.date))) {
    const receipt = receiptsView(s, date).find((r) => r.number === number);
    if (receipt) return receipt;
  }
  return null;
}
