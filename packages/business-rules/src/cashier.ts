export interface PaymentLike {
  kind: 'DELIVERY_PAYMENT' | 'DEBT_PAYMENT';
  dueAmount: number;
  cashAmount: number;
  creditAmount: number;
}

/**
 * Récapitulatif de journée d'un utilisateur qui encaisse (BR-PAY-07) : nombre de bons, total livré
 * ou vendu, espèces sur les livraisons et sur les dettes, crédits accordés, montant attendu.
 */
export function daySummary(payments: readonly PaymentLike[]) {
  const sales = payments.filter((p) => p.kind === 'DELIVERY_PAYMENT');
  const debts = payments.filter((p) => p.kind === 'DEBT_PAYMENT');
  const sum = (list: readonly PaymentLike[], key: keyof Omit<PaymentLike, 'kind'>) =>
    list.reduce((total, p) => total + p[key], 0);
  const cashSales = sum(sales, 'cashAmount');
  const cashDebts = sum(debts, 'cashAmount');
  return {
    receipts: payments.length,
    totalSold: sum(sales, 'dueAmount'),
    cashSales,
    cashDebts,
    credit: sum(sales, 'creditAmount'),
    /** Les espèces encaissées : ce que l'utilisateur doit remettre. */
    expected: cashSales + cashDebts,
  };
}

/** Écart d'un versement (BR-PAY-08) : positif si l'utilisateur remet plus que l'attendu. */
export const settlementGap = (expected: number, remitted: number): number => remitted - expected;
