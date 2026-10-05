import type { RouteProgress } from '@sellwasl/validation';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/** Avancement d'une tournée : résultat de la dernière livraison de chaque commande. */
export async function routeProgress(tx: Pick<Tx, 'order' | 'payment'>, routeId: string) {
  const orders = await tx.order.findMany({
    where: {
      deletedAt: null,
      OR: [{ routeId }, { deliveries: { some: { routeId } } }],
    },
    include: { deliveries: { where: { routeId }, orderBy: { attempt: 'desc' }, take: 1 } },
  });
  const progress: RouteProgress = { delivered: 0, partial: 0, failed: 0, pending: 0, collected: 0 };
  for (const o of orders) {
    const result = o.deliveries[0]?.result;
    if (result === 'DELIVERED') progress.delivered += 1;
    else if (result === 'PARTIAL') progress.partial += 1;
    else if (result === 'FAILED') progress.failed += 1;
    else progress.pending += 1;
  }
  const cash = await tx.payment.aggregate({
    where: { kind: 'DELIVERY_PAYMENT', delivery: { routeId }, deletedAt: null },
    _sum: { cashAmount: true },
  });
  progress.collected = Number(cash._sum.cashAmount ?? 0n);
  return progress;
}
