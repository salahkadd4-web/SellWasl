// Cash van, pointage du camion, bons, versements (phase 20)
import { z } from 'zod';
import { orderLineInput } from './sync';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const amount = z.number().int().min(0).max(10_000_000_000);

export const truckCheckPayload = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), countedQty: z.number().int().min(0).max(1_000_000) }))
    .max(500),
});

export const saleConfirmPayload = z.object({
  orderId: z.uuid(),
  number: z.string().min(3).max(30),
  visitId: z.uuid(),
  lines: z.array(orderLineInput).min(1, 'Le panier est vide').max(200),
  freeVariantChoices: z.record(z.uuid(), z.uuid()).optional(),
  cashAmount: amount,
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});

export const lostDemandPayload = z.object({
  lostDemandId: z.uuid(),
  customerId: z.uuid(),
  variantId: z.uuid(),
  qty: z.number().int().min(1).max(100_000),
});

export const receiptReprintPayload = z.object({ number: z.string().min(3).max(40) });

const loadLines = z
  .array(z.object({ variantId: z.uuid(), unitId: z.uuid(), qty: z.number().int().min(1) }))
  .min(1)
  .max(200);

export const planLoadSchema = z.object({ truckId: z.uuid(), date, lines: loadLines });
export const validateLoadSchema = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), loadedQty: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(200),
});
export const lastLoadQuerySchema = z.object({ truckId: z.uuid() });

export const settlementsQuerySchema = z.object({ date });
export const createSettlementSchema = z.object({ workdayId: z.uuid(), remittedAmount: amount });
export const paymentsQuerySchema = z.object({ from: date, to: date });
export const receiptsQuerySchema = z.object({ date: date.optional() });

interface ArticleRef {
  variantId: string;
  productName: string;
  variantName: string | null;
}

/** Ligne à pointer : en stock dans le camion et à recevoir d'un chargement. */
export interface TruckCheckLine extends ArticleRef {
  inTruck: number;
  toReceive: number;
}

/** De quoi imprimer un bon (BR-IMP-02) ou un reçu de dette. */
export interface ReceiptPrintDto {
  number: string;
  kind: 'DELIVERY' | 'SALE' | 'DEBT';
  at: string;
  user: string;
  customer: { name: string; address: string | null };
  lines: {
    label: string;
    unitName: string;
    qty: number;
    unitPrice: number;
    amount: number;
    free: boolean;
  }[];
  total: number;
  paid: number;
  credit: number;
  /** Dette du client après ce bon. */
  debtAfter: number;
  reprints: number;
}

export interface DaySummaryDto {
  date: string;
  user: { id: string; code: string; name: string };
  receipts: number;
  totalSold: number;
  cashSales: number;
  cashDebts: number;
  credit: number;
  expected: number;
}

export interface SettlementRowDto {
  workdayId: string;
  date: string;
  user: { id: string; code: string; name: string; role: string };
  workdayStatus: string;
  expected: number;
  remitted: number | null;
  gap: number | null;
  validatedAt: string | null;
}

export interface DebtorDto {
  customer: { id: string; code: string | null; name: string };
  debtAmount: number;
  creditLimitAmount: number;
  isCreditAllowed: boolean;
}

export interface PaymentRowDto {
  id: string;
  number: string;
  kind: 'DELIVERY_PAYMENT' | 'DEBT_PAYMENT';
  at: string;
  customer: string;
  user: string;
  dueAmount: number;
  cashAmount: number;
  creditAmount: number;
}
