// BR-PLA-03, BR-PLA-04 : dates de visite, partagées par l'API et le mobile (BR-PLA-07).

export type WeekdayCode = 'SAT' | 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI';

/** Index de Date.getUTCDay() : dimanche = 0. */
const BY_UTC_DAY: readonly WeekdayCode[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Date métier « AAAA-MM-JJ » d'un instant, dans le fuseau de l'entreprise. */
export function localDate(instant: Date, timeZone = 'Africa/Algiers'): string {
  // en-CA formate en AAAA-MM-JJ
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function weekdayOf(date: string): WeekdayCode {
  return BY_UTC_DAY[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Date de référence par défaut d'un client (BR-PLA-03) : le premier jour, à partir de `from`
 * inclus, qui est prévu pour sa partie, travaillé et non férié (BR-PLA-04).
 * Renvoie null si la partie n'a aucun jour prévu parmi les jours travaillés.
 */
export function nextScheduledDate(
  from: string,
  partWeekdays: readonly WeekdayCode[],
  workingDays: readonly WeekdayCode[],
  holidays: readonly string[] = [],
): string | null {
  const days = partWeekdays.filter((d) => workingDays.includes(d));
  if (days.length === 0) return null;
  // Les jours fériés sont rares : un an suffit toujours
  for (let i = 0; i < 366; i += 1) {
    const date = addDaysTo(from, i);
    if (days.includes(weekdayOf(date)) && !holidays.includes(date)) return date;
  }
  return null;
}

/**
 * Nouvelle date de référence quand les jours d'une partie changent : le premier jour, à partir
 * de l'ancienne date incluse, qui est un des nouveaux jours. La semaine de départ est gardée,
 * ce qui conserve la répartition des clients « tous les 15 jours » (BR-PLA-03).
 */
export function shiftToWeekdays(date: string, weekdays: readonly WeekdayCode[]): string | null {
  if (weekdays.length === 0) return null;
  for (let i = 0; i < 7; i += 1) {
    const candidate = addDaysTo(date, i);
    if (weekdays.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

// Clients du jour (BR-PLA-01 à BR-PLA-07) ---------------------------------------------------------

export type FrequencyCode = 'WEEKLY' | 'BIWEEKLY' | 'EVERY_4_WEEKS';

/** Période de chaque fréquence, en semaines ; une nouvelle fréquence s'ajoute ici. */
export const FREQUENCY_WEEKS: Record<FrequencyCode, number> = {
  WEEKLY: 1,
  BIWEEKLY: 2,
  EVERY_4_WEEKS: 4,
};

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Calendrier de l'entreprise et planning du secteur, tels que le téléphone les garde. */
export interface PlanningCalendar {
  workingDays: readonly WeekdayCode[];
  /** Jours fériés « AAAA-MM-JJ ». */
  holidays: readonly string[];
  /** Partie visitée chaque jour de la semaine, dans le secteur du vendeur. */
  partByWeekday: Partial<Record<WeekdayCode, string>>;
}

export interface PlannedCustomer {
  id: string;
  partId: string | null;
  frequency: FrequencyCode;
  /** Première visite prévue ; absente : le client est dû à chaque passage dans sa partie. */
  referenceDate: string | null;
  isActive: boolean;
}

export type DayStatus =
  { kind: 'WORKING'; partId: string | null } | { kind: 'NON_WORKING' } | { kind: 'HOLIDAY' };

/** Jour travaillé, et partie prévue ce jour-là (BR-PLA-04, BR-ORG-07). */
export function dayStatus(date: string, calendar: PlanningCalendar): DayStatus {
  if (calendar.holidays.includes(date)) return { kind: 'HOLIDAY' };
  const weekday = weekdayOf(date);
  if (!calendar.workingDays.includes(weekday)) return { kind: 'NON_WORKING' };
  return { kind: 'WORKING', partId: calendar.partByWeekday[weekday] ?? null };
}

/**
 * Le client est-il du jour à la date D (BR-PLA-02) : jour ouvré, partie prévue ce jour,
 * nombre de semaines depuis la date de référence multiple de la période, client actif et placé.
 */
export function isCustomerDue(
  customer: PlannedCustomer,
  date: string,
  calendar: PlanningCalendar,
): boolean {
  const day = dayStatus(date, calendar);
  if (day.kind !== 'WORKING' || !day.partId) return false;
  if (!customer.isActive || customer.partId !== day.partId) return false;
  if (!customer.referenceDate) return true;
  const days = daysBetween(customer.referenceDate, date);
  if (days < 0) return false;
  return Math.floor(days / 7) % FREQUENCY_WEEKS[customer.frequency] === 0;
}

export interface DayListEntry {
  customerId: string;
  /** Prévu par la fréquence, ou ajouté par une reprogrammation (BR-PLA-05). */
  reason: 'SCHEDULED' | 'RESCHEDULED';
}

/**
 * Liste des clients du jour d'un vendeur (BR-PLA-02, BR-PLA-05, BR-PLA-07) : clients dus ce
 * jour-là, plus les clients reprogrammés à cette date. Un jour non travaillé ou férié n'a pas de
 * clients du jour (BR-PLA-04). Le même calcul tourne sur le serveur et sur le téléphone.
 */
export function dayList(
  customers: readonly PlannedCustomer[],
  date: string,
  calendar: PlanningCalendar,
  rescheduledIds: readonly string[] = [],
): DayListEntry[] {
  if (dayStatus(date, calendar).kind !== 'WORKING') return [];
  const result: DayListEntry[] = [];
  const rescheduled = new Set(rescheduledIds);
  for (const c of customers) {
    if (isCustomerDue(c, date, calendar)) result.push({ customerId: c.id, reason: 'SCHEDULED' });
    else if (rescheduled.has(c.id) && c.isActive)
      result.push({ customerId: c.id, reason: 'RESCHEDULED' });
  }
  return result;
}

/**
 * Visites manquées à la clôture (BR-PLA-06) : les clients du jour qui n'ont pas été visités.
 * Elles ne sont pas reportées automatiquement.
 */
export function missedCustomers(
  list: readonly DayListEntry[],
  visitedCustomerIds: readonly string[],
): string[] {
  const visited = new Set(visitedCustomerIds);
  return list.filter((e) => !visited.has(e.customerId)).map((e) => e.customerId);
}
