import { describe, expect, it } from 'vitest';
import { daySummary, settlementGap } from './cashier';

describe('encaissements', () => {
  it('daySummary : bons, total vendu, espèces, crédits et montant attendu (BR-PAY-07)', () => {
    expect(
      daySummary([
        { kind: 'DELIVERY_PAYMENT', dueAmount: 184500, cashAmount: 160000, creditAmount: 24500 },
        { kind: 'DELIVERY_PAYMENT', dueAmount: 24500, cashAmount: 24500, creditAmount: 0 },
        { kind: 'DEBT_PAYMENT', dueAmount: 20000, cashAmount: 20000, creditAmount: 0 },
      ]),
    ).toEqual({
      receipts: 3,
      totalSold: 209000,
      cashSales: 184500,
      cashDebts: 20000,
      credit: 24500,
      expected: 204500,
    });
    expect(daySummary([])).toMatchObject({ receipts: 0, expected: 0 });
  });

  it('settlementGap : remis − attendu (BR-PAY-08)', () => {
    expect(settlementGap(204500, 204000)).toBe(-500);
    expect(settlementGap(1000, 1200)).toBe(200);
  });
});
