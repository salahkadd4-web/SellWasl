// BR-PLA-01 à BR-PLA-07 ; docs/api.md §5.3
import { z } from 'zod';
import type { Frequency } from './customers';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

export const rescheduleSchema = z.object({ date });

export const planningDayQuerySchema = z.object({ userId: z.uuid(), date });
export const planningCalendarQuerySchema = z.object({
  userId: z.uuid(),
  from: date,
  days: z.coerce.number().int().min(1).max(31).default(14),
});
export const reschedulesQuerySchema = z.object({ userId: z.uuid().optional() });

export type DayStatusValue = 'WORKING' | 'NON_WORKING' | 'HOLIDAY';

/** Liste du jour d'un vendeur, calculée comme sur le téléphone (BR-PLA-07). */
export interface PlanningDay {
  date: string;
  status: DayStatusValue;
  holiday: string | null;
  seller: { id: string; code: string; name: string };
  territory: { id: string; code: string; name: string } | null;
  part: { id: string; name: string } | null;
  customers: {
    id: string;
    code: string | null;
    name: string;
    phone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    partName: string | null;
    frequency: Frequency;
    referenceDate: string | null;
    debtAmount: number;
    reason: 'SCHEDULED' | 'RESCHEDULED';
  }[];
}

export interface PlanningCalendarDay {
  date: string;
  status: DayStatusValue;
  holiday: string | null;
  partName: string | null;
  count: number;
  rescheduledCount: number;
}

export interface RescheduleDto {
  id: string;
  date: string;
  customer: { id: string; code: string | null; name: string };
  createdBy: string | null;
}
