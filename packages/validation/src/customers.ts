// BR-CLI-01 à BR-CLI-05, BR-PAY-02, BR-PLA-03 ; docs/api.md §5.2
import { z } from 'zod';

export const FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'EVERY_4_WEEKS'] as const;
export const frequencySchema = z.enum(FREQUENCIES);
export type Frequency = z.infer<typeof frequencySchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

const customerFields = {
  code: optionalText(30),
  name: z.string().trim().min(1, 'Nom obligatoire').max(120),
  phone: optionalText(30),
  address: optionalText(200),
  customerTypeId: z.uuid(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  frequency: frequencySchema,
  /** Date de la première visite prévue ; calculée si absente (BR-PLA-03). */
  referenceDate: date.nullish(),
  isCreditAllowed: z.boolean(),
  /** Plafond de crédit en DA (BR-PAY-02). */
  creditLimitAmount: z.number().int().min(0).max(1_000_000_000),
  /** Partie choisie par le superviseur : elle est alors forcée (BR-ORG-04). */
  partId: z.uuid().nullish(),
};

const positionComplete = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude == null) === (v.longitude == null);
const positionMessage = { message: 'Latitude et longitude vont ensemble', path: ['latitude'] };

export const createCustomerSchema = z
  .object({
    ...customerFields,
    frequency: customerFields.frequency.default('WEEKLY'),
    isCreditAllowed: customerFields.isCreditAllowed.default(false),
    creditLimitAmount: customerFields.creditLimitAmount.default(0),
  })
  .refine(positionComplete, positionMessage);
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    ...customerFields,
    /** Retire le signalement « fermé définitivement » après vérification. */
    isClosedPermanently: z.literal(false),
  })
  .partial()
  .refine(positionComplete, positionMessage);
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;

export const REVIEW_REASONS = ['NEW', 'OUT_OF_PART', 'CLOSED'] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const customerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  territoryId: z.uuid().optional(),
  /** `none` : clients sans partie. */
  partId: z.union([z.uuid(), z.literal('none')]).optional(),
  customerTypeId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
  /** Clients à revoir (BR-CLI-05). */
  toReview: boolParam,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
});
export type CustomerListQuery = z.input<typeof customerListQuerySchema>;

export interface CustomerDto {
  /** Version de la fiche : renvoyée à la modification (conflit, api.md §1). */
  version: number;
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  customerType: { id: string; code: string; name: string };
  territory: { id: string; code: string; name: string } | null;
  part: { id: string; number: number; name: string } | null;
  isPartForced: boolean;
  frequency: Frequency;
  referenceDate: string | null;
  isCreditAllowed: boolean;
  creditLimitAmount: number;
  debtAmount: number;
  status: 'ACTIVE' | 'INACTIVE';
  isNew: boolean;
  isCashOnly: boolean;
  isClosedPermanently: boolean;
  /** Pourquoi le client est dans la liste « à revoir » (BR-CLI-05). */
  reviewReasons: ReviewReason[];
  createdBy: string | null;
  createdAt: string;
}

export interface CustomerHistory {
  visits: {
    id: string;
    date: string;
    status: string;
    outcome: string | null;
    user: string;
  }[];
  orders: {
    id: string;
    number: string;
    date: string;
    status: string;
    source: string;
    totalAmount: number;
  }[];
  payments: {
    id: string;
    number: string;
    date: string;
    kind: string;
    cashAmount: number;
    creditAmount: number;
    user: string;
  }[];
  /** Écritures de dette : crédits accordés et remboursements (BR-PAY-04). */
  debtEntries: { id: string; date: string; kind: string; amount: number }[];
}

/** Secteur et parties, pour les listes déroulantes des écrans clients. */
export interface TerritoryOption {
  id: string;
  code: string;
  name: string;
  customerTypeIds: string[];
  parts: { id: string; number: number; name: string }[];
}

/** Partie ambiguë (BR-ORG-04) : le superviseur choisit parmi ces parties. */
export interface AmbiguousPartDetails {
  options: { territoryId: string; partId: string; label: string }[];
}

/** Import CSV (BR-IO-01). */
export interface ImportPreview {
  id: string;
  kind: 'CUSTOMERS' | 'PRODUCTS';
  status: 'PREVIEW' | 'IMPORTED' | 'FAILED';
  filename: string;
  totalRows: number;
  validRows: number;
  importedRows: number;
  errors: { line: number; message: string }[];
  /** Colonnes de l'aperçu. */
  columns: string[];
  /** Premières lignes valides, telles qu'elles seront importées. */
  sample: { line: number; values: string[] }[];
}
