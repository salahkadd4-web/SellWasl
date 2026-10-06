// Paie interne, primes, acomptes, retenues et écarts (phase 21 bis)
import { z } from 'zod';
import { payrollSettingsSchema } from './settings';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois au format AAAA-MM');
const money = z.number().int().max(100_000_000);
const positive = money.min(1, 'Le montant doit être positif.');
const note = z.string().trim().max(500);

export const putPayrollSettingsSchema = payrollSettingsSchema;

export const createCompensationSchema = z.object({
  userId: z.uuid(),
  baseSalary: money.min(0, 'Le salaire ne peut pas être négatif.'),
  effectiveFrom: date,
  note: note.optional(),
});
export const compensationQuerySchema = z.object({ userId: z.uuid().optional() });

export const DISCREPANCY_STATUSES = [
  'VALIDATED',
  'UNDER_REVIEW',
  'REJECTED',
  'RESOLVED',
  'DEDUCTION_PENDING',
  'DEDUCTION_APPROVED',
  'DEDUCTION_APPLIED',
] as const;
export type DiscrepancyStatusCode = (typeof DISCREPANCY_STATUSES)[number];
export const discrepanciesQuerySchema = z.object({
  status: z.enum(DISCREPANCY_STATUSES).optional(),
  kind: z.enum(['STOCK', 'FINANCIAL']).optional(),
  userId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});
export const discrepancyDecisionSchema = z
  .object({
    decision: z.enum(['NO_LIABILITY', 'REJECT', 'LIABILITY']),
    /** Montant retenu (≤ manque) ; par défaut le manque entier. */
    amount: positive.optional(),
    note: note.min(3, 'Justifiez la décision.'),
  })
  .refine((d) => d.decision === 'LIABILITY' || d.amount === undefined, {
    message: 'Un montant ne se donne que pour une responsabilité confirmée.',
  });

export const createAdvanceSchema = z.object({
  userId: z.uuid(),
  amount: positive,
  month,
  reason: note.optional(),
});
export const advancesQuerySchema = z.object({
  month: month.optional(),
  userId: z.uuid().optional(),
  status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'PAID', 'DEDUCTED']).optional(),
});
export const decisionNoteSchema = z.object({ note: note.optional() });

export const createDeductionSchema = z.object({
  userId: z.uuid(),
  amount: positive,
  reason: note.min(3, 'Indiquez le motif.'),
  month: month.optional(),
});
export const deductionsQuerySchema = z.object({
  userId: z.uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'APPLIED']).optional(),
});

export const INCENTIVE_KINDS = [
  'PER_UNIT',
  'PERCENT_REVENUE',
  'THRESHOLD',
  'TIERED',
  'REVENUE_TARGET',
] as const;
export const incentiveRuleSchema = z
  .object({
    name: z.string().trim().min(1, 'Nom obligatoire').max(120),
    kind: z.enum(INCENTIVE_KINDS),
    frequency: z.enum(['WEEKLY', 'MONTHLY']),
    productId: z.uuid().nullish(),
    unitId: z.uuid().nullish(),
    amount: positive.nullish(),
    percentBp: z.number().int().min(1).max(10_000).nullish(),
    threshold: z.number().int().min(1).nullish(),
    tiers: z
      .array(z.object({ minQty: z.number().int().min(0), unitAmount: money.min(0) }))
      .max(10)
      .nullish(),
    userId: z.uuid().nullish(),
    roleCode: z.enum(['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR']).nullish(),
    isActive: z.boolean().default(true),
    validFrom: date,
    validTo: date.nullish(),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (!r.userId === !r.roleCode) issue('Choisissez un employé ou un rôle.', 'userId');
    if (
      (r.kind === 'PER_UNIT' || r.kind === 'THRESHOLD' || r.kind === 'REVENUE_TARGET') &&
      !r.amount
    )
      issue('Indiquez le montant de la prime.', 'amount');
    if ((r.kind === 'THRESHOLD' || r.kind === 'REVENUE_TARGET') && !r.threshold)
      issue('Indiquez le seuil.', 'threshold');
    if (r.kind === 'PERCENT_REVENUE' && !r.percentBp)
      issue('Indiquez le pourcentage.', 'percentBp');
    if (r.kind === 'TIERED') {
      const tiers = r.tiers ?? [];
      if (tiers.length === 0) issue('Ajoutez au moins un palier.', 'tiers');
      if (tiers.some((t, i) => i > 0 && t.minQty <= tiers[i - 1]!.minQty))
        issue('Les paliers doivent être croissants.', 'tiers');
    }
    if ((r.kind === 'PER_UNIT' || r.kind === 'THRESHOLD' || r.kind === 'TIERED') && !r.productId)
      issue('Choisissez le produit compté.', 'productId');
    if (r.validTo && r.validTo < r.validFrom) issue('La fin précède le début.', 'validTo');
  });
export const calculateIncentivesSchema = z.object({
  /** Une date de la période : la semaine ou le mois qui la contient. */
  date,
  frequency: z.enum(['WEEKLY', 'MONTHLY']),
});
export const incentivesQuerySchema = z.object({
  periodStart: date.optional(),
  status: z.enum(['CALCULATED', 'VALIDATED', 'REJECTED', 'APPLIED']).optional(),
  userId: z.uuid().optional(),
});

export const createPayrollPeriodSchema = z.object({ month });
/** Date de la période en cours (défaut : aujourd'hui). */
export const progressQuerySchema = z.object({ date: date.optional() });
export const createAdjustmentSchema = z.object({
  userId: z.uuid(),
  month,
  amount: money.min(-100_000_000).refine((v) => v !== 0, 'Le montant ne peut pas être nul.'),
  reason: note.min(3, 'Indiquez le motif.'),
});
export const monthQuerySchema = z.object({ month: month.optional() });

export interface PersonDto {
  id: string;
  code: string;
  name: string;
  role: string;
}

export interface CompensationDto {
  id: string;
  user: PersonDto;
  baseSalary: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface CurrentCompensationDto {
  user: PersonDto;
  current: CompensationDto | null;
}

export interface DiscrepancyDto {
  id: string;
  kind: 'STOCK' | 'FINANCIAL';
  status: DiscrepancyStatusCode;
  date: string;
  user: PersonDto;
  workdayId: string;
  article: string | null;
  qty: number | null;
  unitValue: number | null;
  amount: number;
  cause: string | null;
  validatedBy: string;
  validatedAt: string;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  deduction: { id: string; amount: number; status: string } | null;
}

export interface SettlementDetailDto {
  workdayId: string;
  date: string;
  user: PersonDto;
  expected: number;
  remitted: number | null;
  gap: number | null;
  note: string | null;
  sales: number;
  cashSales: number;
  cashDebts: number;
  credit: number;
  receipts: number;
  returnedValue: number;
  stockDiscrepancies: DiscrepancyDto[];
  financialDiscrepancy: DiscrepancyDto | null;
}

export interface AdvanceDto {
  id: string;
  user: PersonDto;
  month: string;
  amount: number;
  reason: string | null;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'DEDUCTED';
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  paidAt: string | null;
}

export interface DeductionDto {
  id: string;
  user: PersonDto;
  amount: number;
  reason: string;
  sourceType: 'STOCK_DISCREPANCY' | 'FINANCIAL_DISCREPANCY' | 'OTHER';
  discrepancyId: string | null;
  month: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED';
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
}

export interface IncentiveRuleDto {
  id: string;
  name: string;
  kind: (typeof INCENTIVE_KINDS)[number];
  frequency: 'WEEKLY' | 'MONTHLY';
  product: { id: string; name: string } | null;
  unit: { id: string; name: string } | null;
  amount: number | null;
  percentBp: number | null;
  threshold: number | null;
  tiers: { minQty: number; unitAmount: number }[] | null;
  user: PersonDto | null;
  roleCode: string | null;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
}

export interface IncentiveDto {
  id: string;
  rule: { id: string; name: string; kind: string };
  user: PersonDto;
  periodStart: string;
  periodEnd: string;
  quantity: number;
  revenue: number;
  unitAmount: number | null;
  amount: number;
  unitName: string | null;
  status: 'CALCULATED' | 'VALIDATED' | 'REJECTED' | 'APPLIED';
  /** Ventes comptées : commande, livraison, quantité dans l'unité de la règle, montant. */
  details: { orderNumber: string; deliveryNumber: string; qty: number; amount: number }[];
  validatedBy: string | null;
  validatedAt: string | null;
}

/** Progression en direct d'une règle de prime pour l'employé connecté. */
export interface IncentiveProgressDto {
  rule: {
    id: string;
    name: string;
    kind: (typeof INCENTIVE_KINDS)[number];
    frequency: 'WEEKLY' | 'MONTHLY';
    amount: number | null;
    threshold: number | null;
    percentBp: number | null;
    tiers: { minQty: number; unitAmount: number }[] | null;
  };
  periodStart: string;
  periodEnd: string;
  quantity: number;
  revenue: number;
  unitAmount: number | null;
  estimatedAmount: number;
  unitName: string | null;
  /** Prime déjà enregistrée pour la période (calculée, validée…), sinon null. */
  status: IncentiveDto['status'] | null;
}

export type PayrollStatusCode = 'OPEN' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'CLOSED';

export interface PayrollLineDto {
  id: string;
  kind:
    | 'BASE_SALARY'
    | 'INCENTIVE'
    | 'OBJECTIVE_BONUS'
    | 'DRIVER_BONUS'
    | 'ADJUSTMENT'
    | 'ADVANCE'
    | 'DEDUCTION';
  label: string;
  amount: number;
  sourceType: string | null;
  sourceId: string | null;
}

export interface PayrollPaymentDto {
  id: string;
  installment: number;
  dueDate: string;
  percent: number;
  amount: number;
  paidAt: string | null;
  paidBy: string | null;
}

export interface PayrollEntryDto {
  id: string;
  user: PersonDto;
  baseSalary: number;
  earnings: number;
  advances: number;
  deductions: number;
  net: number;
  lines: PayrollLineDto[];
  payments: PayrollPaymentDto[];
}

export interface PayrollPeriodDto {
  id: string;
  month: string;
  status: PayrollStatusCode;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  totals: {
    employees: number;
    baseSalary: number;
    earnings: number;
    advances: number;
    deductions: number;
    net: number;
    paid: number;
  };
  entries: PayrollEntryDto[];
}

export interface PayrollAdjustmentDto {
  id: string;
  user: PersonDto;
  month: string;
  amount: number;
  reason: string;
  applied: boolean;
  createdAt: string;
}

export interface PayrollDashboardDto {
  month: string;
  employees: number;
  payrollStatus: PayrollStatusCode | null;
  baseSalary: number;
  advancesPaid: number;
  deductionsApproved: number;
  incentivesValidated: number;
  net: number | null;
  pending: { advances: number; deductions: number; incentives: number; discrepancies: number };
}

export interface MyPayDto {
  month: string;
  compensation: CompensationDto[];
  incentives: IncentiveDto[];
  advances: AdvanceDto[];
  deductions: DeductionDto[];
  entry: (PayrollEntryDto & { status: PayrollStatusCode }) | null;
}
