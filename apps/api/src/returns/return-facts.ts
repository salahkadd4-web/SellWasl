import { rule } from '../field/field-errors';
import type { Prisma } from '../generated/prisma/client';
import { uuidv7 } from '../common/uuid';

type Tx = Prisma.TransactionClient;

/** Axes figés d'un fait de retour (phase 21) : la valeur du moment, sans clé étrangère. */
export interface FactAxes {
  sellerUserId?: string | null;
  driverUserId?: string | null;
  customerId?: string | null;
  territoryId?: string | null;
  partId?: string | null;
  routeId?: string | null;
  orderId?: string | null;
  deliveryId?: string | null;
  unloadId?: string | null;
  reasonId?: string | null;
  lotId?: string | null;
  supplierId?: string | null;
  condition?: 'RESTOCK' | 'DEFECTIVE' | 'EXPIRED' | 'BROKEN' | null;
}

export interface NewFact extends FactAxes {
  kind: 'REFUSAL' | 'RESALE' | 'RETURN' | 'GAP';
  productVariantId: string;
  productId: string;
  /** Unité de base ; signée pour un écart. */
  qty: number;
  /** DA, arrondi. */
  value: number;
}

/** Écrit des faits de retour dans la transaction de l'opération qui les produit. */
export async function writeFacts(
  tx: Tx,
  companyId: string,
  date: Date,
  facts: NewFact[],
): Promise<void> {
  const rows = facts.filter((f) => f.qty !== 0);
  if (rows.length === 0) return;
  await tx.returnFact.createMany({
    data: rows.map((f) => ({
      id: uuidv7(),
      companyId,
      date,
      ...f,
      value: BigInt(Math.max(0, Math.round(f.value))),
    })),
  });
}

/** Motif de refus actif, obligatoire dès qu'une quantité est refusée (BR-RET-01). */
export async function refusalReason(tx: Tx, reasonId: string | null | undefined): Promise<string> {
  const reason = reasonId
    ? await tx.reason.findFirst({
        where: { id: reasonId, kind: 'REFUSAL', isActive: true, deletedAt: null },
      })
    : null;
  if (!reason)
    throw rule('Choisissez le motif du refus.', { rule: 'BR-RET-01', field: 'refusalReasonId' });
  return reason.id;
}

/** Axes d'une commande livrée ou refusée : pré-vendeur, client, secteur, partie, tournée. */
export function orderAxes(order: {
  id: string;
  sellerUserId: string;
  customerId: string;
  routeId: string | null;
  customer: { territoryId: string | null; partId: string | null };
}): FactAxes {
  return {
    orderId: order.id,
    sellerUserId: order.sellerUserId,
    customerId: order.customerId,
    territoryId: order.customer.territoryId,
    partId: order.customer.partId,
    routeId: order.routeId,
  };
}
