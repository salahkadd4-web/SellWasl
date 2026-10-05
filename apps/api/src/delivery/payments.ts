import { minimumCash } from '@sellwasl/business-rules';
import { uuidv7 } from '../common/uuid';
import { rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Minimum à encaisser sur un bon (BR-PAY-03), selon le crédit du client. */
export function minimumFor(
  customer: { isCreditAllowed: boolean; creditLimitAmount: bigint; debtAmount: bigint },
  due: number,
): number {
  return minimumCash({
    due,
    isCreditAllowed: customer.isCreditAllowed,
    creditLimit: Number(customer.creditLimitAmount),
    debt: Number(customer.debtAmount),
  });
}

/**
 * Paiement d'une livraison ou d'une vente (BR-PAY-03, BR-PAY-04) : encaissé contrôlé, reste à
 * crédit ajouté à la dette du client. Renvoie le crédit et la dette après le bon.
 */
export async function recordDeliveryPayment(
  tx: Tx,
  x: {
    companyId: string;
    number: string;
    due: number;
    cash: number;
    customer: {
      id: string;
      isCreditAllowed: boolean;
      creditLimitAmount: bigint;
      debtAmount: bigint;
    };
    userId: string;
    deviceId: string | null;
    workdayId: string;
    orderId: string;
    deliveryId: string;
    occurredAt: Date;
  },
): Promise<{ credit: number; debt: bigint }> {
  const minimum = minimumFor(x.customer, x.due);
  if (x.cash < minimum)
    throw rule(`Encaissez au moins ${minimum} DA (plafond de crédit du client).`, {
      rule: 'BR-PAY-03',
      minimumCash: minimum,
    });
  if (x.cash > x.due) throw rule('Le montant encaissé dépasse le montant dû.');
  const credit = x.due - x.cash;
  const paymentId = uuidv7();
  await tx.payment.create({
    data: {
      id: paymentId,
      companyId: x.companyId,
      number: x.number,
      kind: 'DELIVERY_PAYMENT',
      dueAmount: BigInt(x.due),
      cashAmount: BigInt(x.cash),
      creditAmount: BigInt(credit),
      customerId: x.customer.id,
      userId: x.userId,
      workdayId: x.workdayId,
      orderId: x.orderId,
      deliveryId: x.deliveryId,
      createdByUserId: x.userId,
      createdByDeviceId: x.deviceId,
      occurredAt: x.occurredAt,
    },
  });
  let debt = x.customer.debtAmount;
  if (credit > 0) {
    await tx.customerDebtEntry.create({
      data: {
        id: uuidv7(),
        companyId: x.companyId,
        customerId: x.customer.id,
        kind: 'CREDIT_SALE',
        amount: BigInt(credit),
        occurredAt: x.occurredAt,
        paymentId,
      },
    });
    debt = (
      await tx.customer.update({
        where: { id: x.customer.id },
        data: { debtAmount: { increment: BigInt(credit) }, version: { increment: 1 } },
      })
    ).debtAmount;
  }
  return { credit, debt };
}
