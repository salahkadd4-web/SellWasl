import { describe, expect, it } from 'vitest';
import { applyOps } from './effects';
import { DATE, op, sellerState } from './fixtures';
import { buildOrder } from './order-build';
import { customerView, ordersView, todayView, visitCatalogView } from './views/seller';

const dayStart = () => [
  op('workday.start', { workdayId: 'w1', date: DATE }),
  op('visit.start', { visitId: 'v1', customerId: 'c1', mode: 'PHONE' }),
];
const order = (qty: number, extra = {}) =>
  op(
    'order.confirm',
    {
      orderId: 'o1',
      number: 'V07-B0001',
      visitId: 'v1',
      lines: [{ variantId: 'TOM', unitId: 'tom-ctn', qty }],
    },
    extra,
  );

describe('vue locale du pré-vendeur (spec phase 23 §4.4)', () => {
  it('journée reçue, sans opération en file', () => {
    const today = todayView(sellerState(), DATE);
    expect(today.workday).toBeNull();
    expect(today.day.customers.map((c) => c.id)).toEqual(['c1']);
    expect(today.counters).toMatchObject({ planned: 1, visited: 0, ordersCount: 0 });
    expect(today.seller).toEqual({ code: 'V07', series: 'B', roleCode: 'PRE_VENDEUR' });
  });

  it('démarrage, visite puis commande : journée, visite en cours, compteurs', () => {
    const started = applyOps(sellerState(), dayStart());
    let today = todayView(started, DATE);
    expect(today.workday).toMatchObject({ id: 'w1', status: 'IN_PROGRESS' });
    expect(today.currentVisit).toMatchObject({
      id: 'v1',
      isScheduled: true,
      status: 'IN_PROGRESS',
    });

    const ordered = applyOps(sellerState(), [...dayStart(), order(8)]);
    today = todayView(ordered, DATE);
    expect(today.currentVisit).toBeNull();
    expect(today.counters).toMatchObject({ visited: 1, ordersCount: 1, ordersAmount: 8 * 5800 });
    expect(ordersView(ordered, DATE)[0]).toMatchObject({
      id: 'o1',
      status: 'CONFIRMED',
      totalAmount: 46_400,
    });
  });

  it('le quota restant baisse avec une commande en file', () => {
    const before = visitCatalogView(applyOps(sellerState(), dayStart()), 'c1', DATE);
    expect(before.products[0]!.variants[0]).toMatchObject({
      quotaRemaining: 200,
      quotaReached: false,
    });
    const after = visitCatalogView(applyOps(sellerState(), [...dayStart(), order(8)]), 'c1', DATE);
    expect(after.products[0]!.variants[0]).toMatchObject({ quotaRemaining: 40 });
  });

  it('au-delà du quota restant : ligne en attente et découpage attendu', () => {
    const built = buildOrder(sellerState(), {
      customerTypeId: 'DETAIL',
      date: DATE,
      lines: [{ variantId: 'TOM', unitId: 'tom-ctn', qty: 12 }],
      cashVan: false,
    });
    expect(built.lines.map((l) => [l.kind, l.enteredQty, l.unitPrice])).toEqual([
      ['NORMAL', 10, 5600],
      ['PENDING', 2, 5600],
    ]);
    expect(built.expected).toEqual([{ variantId: 'TOM', pendingQty: 40, stockoutQty: 0 }]);
    expect(built.totalAmount).toBe(56_000);
  });

  it('encaissement de dette : dette du client et encaissé du jour', () => {
    const s = applyOps(sellerState(), [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op('payment.debt', { paymentId: 'p1', number: 'V07-B0002', customerId: 'c1', amount: 400 }),
    ]);
    expect(customerView(s, 'c1')!.debtAmount).toBe(600);
    const today = todayView(s, DATE);
    expect(today.day.customers[0]!.debtAmount).toBe(600);
    expect(today.counters.collectedAmount).toBe(400);
  });

  it('une opération refusée n’a aucun effet (quota, dette, commande)', () => {
    const s = applyOps(sellerState(), [
      ...dayStart(),
      order(8, { status: 'CONFLICT' }),
      op(
        'payment.debt',
        { paymentId: 'p1', number: 'X', customerId: 'c1', amount: 400 },
        { status: 'CONFLICT' },
      ),
    ]);
    expect(ordersView(s, DATE)).toEqual([]);
    expect(customerView(s, 'c1')!.debtAmount).toBe(1000);
    expect(visitCatalogView(s, 'c1', DATE).products[0]!.variants[0]!.quotaRemaining).toBe(200);
  });

  it('opération reflétée par la réception : pas de double effet', () => {
    const s = applyOps(sellerState(), [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op(
        'payment.debt',
        { paymentId: 'p1', number: 'X', customerId: 'c1', amount: 400 },
        { status: 'SYNCED', reflected: true },
      ),
    ]);
    expect(customerView(s, 'c1')!.debtAmount).toBe(1000);
  });

  it('clôture : commandes figées, clients du jour non visités manqués', () => {
    const s = applyOps(sellerState(), [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op('workday.close', { workdayId: 'w1' }),
    ]);
    const today = todayView(s, DATE);
    expect(today.workday!.status).toBe('CLOSED');
    expect(today.visits).toEqual([expect.objectContaining({ customerId: 'c1', status: 'MISSED' })]);
  });
});
