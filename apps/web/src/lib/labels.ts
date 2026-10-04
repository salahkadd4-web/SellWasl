/** Libellés français des codes de l'API. */
export const MODE_LABELS: Record<string, string> = {
  PRE_SALES: 'Prévente',
  CASH_VAN: 'Cash van',
  MIXED: 'Mixte',
};
export const MODULE_LABELS: Record<string, string> = {
  PRE_SALES: 'Prévente',
  DELIVERY: 'Livraison',
  CASH_VAN: 'Cash van',
  WAREHOUSE: 'Entrepôt et stock',
  ANALYTICS: 'Analyse',
};
export const COMPANY_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  TRIAL: { label: 'Essai', tone: 'neutral' },
  SUSPENDED: { label: 'Suspendue', tone: 'danger' },
  CANCELLED: { label: 'Résiliée', tone: 'danger' },
  DELETED: { label: 'Supprimée', tone: 'danger' },
};
export function formatDateTime(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: 'Chaque semaine',
  BIWEEKLY: 'Toutes les 2 semaines',
  EVERY_4_WEEKS: 'Toutes les 4 semaines',
};

/** Montant en dinars, sans décimales : « 42 000 DA ». */
export function formatDA(amount: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} DA`;
}

export function formatDate(date: string | null): string {
  return date
    ? new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-DZ', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';
}

export const WEEKDAY_LABELS: [string, string][] = [
  ['SAT', 'Samedi'],
  ['SUN', 'Dimanche'],
  ['MON', 'Lundi'],
  ['TUE', 'Mardi'],
  ['WED', 'Mercredi'],
  ['THU', 'Jeudi'],
  ['FRI', 'Vendredi'],
];
