import { describe, expect, it } from 'vitest';
import { applyOps } from './effects';
import { DATE, op, sellerRows } from './fixtures';
import { loadState } from './local-state';
import { customerView, todayView } from './views/seller';
import { daySummaryView, receiptsView, truckCheckView, truckStockView } from './views/truck';

/** Vendeur cash van : 400 triplettes de thon (20 cartons) dans le camion. */
function cashVanState() {
  return loadState({
    ...sellerRows('VENDEUR_CASH_VAN'),
    truckStock: [
      {
        id: 'TOM',
        data: {
          variantId: 'TOM',
          productId: 'TOM',
          productName: 'Thon tomate',
          variantName: null,
          qty: 400,
          units: [
            { id: 'tom-trip', name: 'triplette', baseQty: 1, isBase: true },
            { id: 'tom-ctn', name: 'carton', baseQty: 20, isBase: false },
          ],
        },
      },
    ],
    truckCheck: [
      {
        id: 'current',
        data: {
          lines: [
            {
              variantId: 'TOM',
              productId: 'TOM',
              productName: 'Thon tomate',
              variantName: null,
              inTruck: 400,
              toReceive: 0,
            },
          ],
        },
      },
    ],
    depotStock: [],
  });
}

const start = () => [
  op('workday.start', { workdayId: 'w1', date: DATE }),
  op('visit.start', { visitId: 'v1', customerId: 'c1', mode: 'ON_SITE' }),
];
const sale = (cartons: number, cash: number) =>
  op('sale.confirm', {
    orderId: 's1',
    number: 'C01-B0001',
    visitId: 'v1',
    lines: [{ variantId: 'TOM', unitId: 'tom-ctn', qty: cartons }],
    cashAmount: cash,
  });

describe('cash van hors connexion (spec phase 23 §4.4)', () => {
  it('une vente en file baisse le stock du camion et ajoute le crédit à la dette', () => {
    const s = applyOps(cashVanState(), [...start(), sale(2, 5000)]);
    expect(truckStockView(s).find((t) => t.variantId === 'TOM')!.qty).toBe(360);
    expect(customerView(s, 'c1')!.debtAmount).toBe(1000 + 2 * 5800 - 5000);
    expect(todayView(s, DATE).counters).toMatchObject({ ordersCount: 1, visited: 1 });
  });

  it('résumé de la journée et bon de vente construits sur le téléphone', () => {
    const s = applyOps(cashVanState(), [
      ...start(),
      sale(2, 5000),
      op('payment.debt', { paymentId: 'p2', number: 'C01-B0002', customerId: 'c1', amount: 1000 }),
    ]);
    expect(daySummaryView(s, DATE)).toEqual({
      date: DATE,
      user: { id: 'u1', code: 'V07', name: 'Ahmed Kaci' },
      receipts: 2,
      totalSold: 11_600,
      cashSales: 5000,
      cashDebts: 1000,
      credit: 6600,
      expected: 6000,
    });
    const [saleReceipt, debtReceipt] = receiptsView(s, DATE);
    expect(saleReceipt).toMatchObject({
      number: 'C01-B0001',
      kind: 'SALE',
      customer: { name: 'Épicerie Amine', address: 'Rue 1' },
      lines: [
        {
          label: 'Thon tomate',
          unitName: 'carton',
          qty: 2,
          unitPrice: 5800,
          amount: 11_600,
          free: false,
        },
      ],
      total: 11_600,
      paid: 5000,
      credit: 6600,
      reprints: 0,
    });
    expect(debtReceipt).toMatchObject({ kind: 'DEBT', total: 1000, paid: 1000, lines: [] });
    // Dette après : celle du client à jour (1 000 + 6 600 − 1 000)
    expect(saleReceipt!.debtAfter).toBe(6600);
  });

  it('pointage du camion : le stock devient le compté, plus rien à recevoir', () => {
    const s = applyOps(cashVanState(), [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op('truck.check', { lines: [{ variantId: 'TOM', countedQty: 380 }] }),
    ]);
    expect(truckStockView(s)[0]!.qty).toBe(380);
    expect(truckCheckView(s)).toEqual([
      expect.objectContaining({ variantId: 'TOM', inTruck: 380, toReceive: 0 }),
    ]);
  });

  it('journée complète en file : démarrage, pointage, visites, vente, encaissement, clôture', () => {
    const s = applyOps(cashVanState(), [
      op('workday.start', { workdayId: 'w1', date: DATE }),
      op('truck.check', { lines: [{ variantId: 'TOM', countedQty: 400 }] }),
      op('visit.start', { visitId: 'v1', customerId: 'c1', mode: 'ON_SITE' }),
      sale(3, 17_400),
      op('payment.debt', { paymentId: 'p2', number: 'C01-B0002', customerId: 'c1', amount: 1000 }),
      op('workday.close', { workdayId: 'w1' }),
    ]);
    const today = todayView(s, DATE);
    expect(today.workday!.status).toBe('CLOSED');
    expect(today.counters).toMatchObject({
      visited: 1,
      ordersCount: 1,
      ordersAmount: 17_400,
      collectedAmount: 18_400,
    });
    expect(truckStockView(s)[0]!.qty).toBe(340);
    expect(customerView(s, 'c1')!.debtAmount).toBe(0);
    expect(daySummaryView(s, DATE).expected).toBe(18_400);
  });
});
