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
