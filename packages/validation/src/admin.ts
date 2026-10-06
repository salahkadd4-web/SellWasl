// Phases 8 et 9 — plateforme, utilisateurs et paramétrage (UC-80, UC-82, UC-90)
import { z } from 'zod';

const name = (label: string, max = 80) => z.string().trim().min(1, `${label} obligatoire`).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email('Email invalide')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const SALES_MODE_VALUES = ['PRE_SALES', 'CASH_VAN', 'MIXED'] as const;
export const ROLE_VALUES = [
  'COMPANY_ADMIN',
  'SUPERVISEUR',
  'COMPTABLE',
  'PRE_VENDEUR',
  'VENDEUR_CASH_VAN',
  'LIVREUR',
  'MAGASINIER',
] as const;

/** Code libre et unique (BR-USR-10) : lettres, chiffres et tirets. */
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Code obligatoire')
  .max(30)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Lettres, chiffres et tirets uniquement');

// ---------------------------------------------------------------- Plateforme (UC-90)

export const createCompanySchema = z.object({
  name: name("Nom de l'entreprise", 120),
  code: codeSchema.refine((c) => c.length >= 3, 'Au moins 3 caractères'),
  mode: z.enum(SALES_MODE_VALUES),
  admin: z.object({
    firstName: name('Prénom'),
    lastName: name('Nom'),
    email,
    code: codeSchema.default('ADMIN'),
  }),
});
export type CreateCompanyInput = z.input<typeof createCompanySchema>;

export interface PlatformCompany {
  id: string;
  code: string;
  name: string;
  mode: (typeof SALES_MODE_VALUES)[number];
  status: string;
  modules: string[];
  users: number;
  createdAt: string;
}

export interface CreateCompanyResponse {
  company: PlatformCompany;
  admin: { code: string; email: string | null; temporaryPassword: string };
}

// ---------------------------------------------------------------- Utilisateurs (UC-80)

export const createUserSchema = z.object({
  code: codeSchema,
  firstName: name('Prénom'),
  lastName: name('Nom'),
  role: z.enum(ROLE_VALUES),
  phone: optionalText(30),
  email,
});
export type CreateUserInput = z.input<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial();
export type UpdateUserInput = z.input<typeof updateUserSchema>;

export interface CompanyUser {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  role: { code: string; name: string; channel: 'WEB' | 'MOBILE' };
  status: 'ACTIVE' | 'DISABLED';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface TemporaryPasswordResponse {
  user: CompanyUser;
  temporaryPassword: string;
}

// ---------------------------------------------------------------- Paramétrage (UC-82)

export const customerTypeSchema = z.object({
  code: codeSchema,
  name: name('Nom'),
  isActive: z.boolean().default(true),
});

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  label: name('Libellé'),
});

export const REASON_KINDS = [
  'NO_ORDER',
  'DELIVERY_FAILURE',
  'ADJUSTMENT',
  'FORCED_CLOSE',
  'REOPEN',
  'REFUSAL',
] as const;
export const reasonSchema = z.object({
  kind: z.enum(REASON_KINDS),
  label: name('Libellé'),
  isActive: z.boolean().default(true),
});

export const warehouseSchema = z.object({
  type: z.enum(['DEPOT', 'TRUCK']),
  code: codeSchema,
  name: name('Nom'),
  plateNumber: optionalText(30),
  assignedUserId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});
