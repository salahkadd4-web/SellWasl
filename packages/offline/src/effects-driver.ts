import { type Effect, num, str } from './effect-kit';
import { openWorkday } from './local-state';
import { takeFromTruck } from './effects-truck';
import type { OutboxOp } from './types';
import { computeDelivery, findDelivery } from './views/driver';

/** Effets des opérations du livreur (BR-LIV, BR-PAY-03). */
export const DRIVER_EFFECTS: Partial<Record<OutboxOp['type'], Effect>> = {
  // Livrée ou partielle : quantités, prix recalculés, encaissement, dette, sortie du camion
  'delivery.confirm': (s, p, op) => {
    const orderId = str(p.orderId) ?? '';
    const workday = openWorkday(s);
    const found = findDelivery(s, orderId);
    if (!found || found.delivery.delivery || !workday) return;
    const c = computeDelivery(s, {
      orderId,
      lines: (p.lines as { lineId: string; qty: number }[]) ?? [],
      added: (p.added as { variantId: string; unitId: string; qty: number }[]) ?? [],
    });
    const { delivery } = found;
    const partial = c.lines.some((l) => l.refused > 0);
    delivery.lines = [
      ...c.lines.map((l) => ({ ...l.line, unitPrice: l.unitPrice, deliveredQty: l.qty })),
      ...c.fresh.map((f, i) => {
        const product = s.products.find((x) => x.id === f.productId);
        const variant = product?.variants.find((v) => v.id === f.variantId);
        const unit = product?.units.find((u) => u.id === f.unitId);
        return {
          lineId: `added-${op.opId}-${i}`,
          kind: 'NORMAL' as const,
          variantId: f.variantId,
          productName: product?.name ?? '',
          variantName: variant && !variant.isDefault ? variant.name : null,
          unitId: f.unitId,
          unitName: unit?.name ?? '',
          unitBaseQty: unit?.baseQty ?? 1,
          preparedQty: 0,
          unitPrice: f.unitPrice,
          deliveredQty: f.qty,
          bonusRuleId: null,
        };
      }),
    ];
    for (const l of delivery.lines)
      takeFromTruck(s, l.variantId, (l.deliveredQty ?? 0) * l.unitBaseQty);
    const cash = Math.min(num(p.cashAmount) ?? 0, c.due);
    delivery.delivery = { number: str(p.number) ?? '', result: partial ? 'PARTIAL' : 'DELIVERED' };
    delivery.status = partial ? 'PARTIALLY_DELIVERED' : 'DELIVERED';
    delivery.totalAmount = c.due;
    s.payments.push({
      id: `pay-${str(p.deliveryId)}`,
      number: delivery.delivery.number,
      kind: 'DELIVERY_PAYMENT',
      at: op.occurredAt,
      workdayId: workday.id,
      customerId: delivery.customer.id,
      orderId,
      dueAmount: c.due,
      cashAmount: cash,
      creditAmount: c.due - cash,
    });
    const debt = c.debt + c.due - cash;
    delivery.customer.debtAmount = debt;
    const customer = s.customers.get(delivery.customer.id);
    if (customer) customer.debtAmount = debt;
  },

  'delivery.fail': (s, p) => {
    const found = findDelivery(s, str(p.orderId) ?? '');
    if (!found || found.delivery.delivery) return;
    found.delivery.delivery = { number: str(p.number) ?? '', result: 'FAILED' };
    // Reprogrammée ou non : le serveur décide (P-05) ; la livraison n'est plus à faire
    found.delivery.status = 'FAILED';
  },
};
