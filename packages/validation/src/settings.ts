// BR-TEN-06, BR-TEN-07, BR-TEN-08 ; docs/database.md §5
import { z } from 'zod';

export const WEEKDAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
export const weekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof weekdaySchema>;

/** Règles réglables P-01 à P-10, avec leurs valeurs par défaut validées le 2026-10-02. */
export const companyRulesSchema = z.object({
  P01_workOnNonWorkingDays: z.boolean().default(true),
  P02_outOfProgramVisits: z.boolean().default(true),
  P03_bonusConsumesQuota: z.boolean().default(false),
  P04_recalculateOnDecrease: z.boolean().default(true),
  P05_rescheduleFailedDelivery: z.boolean().default(true),
  P06_fullUnload: z.boolean().default(true),
  P07_multipleCashVanLoads: z.boolean().default(true),
  P08_driverCollectsOldDebts: z.boolean().default(true),
  P09_newCustomerActiveImmediately: z.boolean().default(true),
  P10_supervisorEditsPrices: z.boolean().default(false),
});
export type CompanyRules = z.infer<typeof companyRulesSchema>;

export const companySettingsSchema = z.object({
  workingDays: z.array(weekdaySchema).min(1).default(['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU']),
  outOfZoneDistanceM: z.number().int().min(10).max(5000).default(100),
  ticketWidthMm: z.union([z.literal(58), z.literal(80)]).default(58),
  positionIntervalMin: z.number().int().min(1).max(60).default(5),
  /** Plafond des primes d'objectifs, décidé par la direction (BR-OBJ-01) ; null : pas de plafond. */
  objectiveCapPercent: z.number().int().min(100).max(500).nullable().default(120),
  /** Versement des primes : 0 = fin du mois de l'objectif, 1 = fin du mois suivant. */
  objectivePaymentDelayMonths: z.union([z.literal(0), z.literal(1)]).default(0),
  receiptHeader: z
    .object({
      name: z.string().max(60).default(''),
      address: z.string().max(120).default(''),
      phone: z.string().max(30).default(''),
    })
    .prefault({}),
  rules: companyRulesSchema.prefault({}),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

/** Paramètres d'une nouvelle entreprise : toutes les valeurs par défaut. */
export function defaultCompanySettings(): CompanySettings {
  return companySettingsSchema.parse({});
}
