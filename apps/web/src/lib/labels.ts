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

export const ORDER_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  DRAFT: { label: 'Panier', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmée', tone: 'success' },
  LOCKED: { label: 'Figée', tone: 'neutral' },
  PREPARING: { label: 'En préparation', tone: 'warning' },
  READY: { label: 'Préparée', tone: 'warning' },
  OUT_FOR_DELIVERY: { label: 'En livraison', tone: 'warning' },
  DELIVERED: { label: 'Livrée', tone: 'success' },
  PARTIALLY_DELIVERED: { label: 'Livrée partiellement', tone: 'warning' },
  FAILED: { label: 'Échouée', tone: 'danger' },
  CANCELLED: { label: 'Annulée', tone: 'danger' },
};

export const WORKDAY_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  NOT_STARTED: { label: 'Non démarrée', tone: 'neutral' },
  IN_PROGRESS: { label: 'En cours', tone: 'success' },
  CLOSED: { label: 'Clôturée', tone: 'warning' },
};

export const ORDER_SOURCE_LABELS: Record<string, string> = {
  PRE_SALES: 'Visite',
  PHONE: 'Téléphone',
  CASH_VAN: 'Cash van',
};

/** Date du jour dans le fuseau du navigateur, « AAAA-MM-JJ ». */
export function todayDate(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const MOVEMENT_TYPE: Record<string, string> = {
  IN: 'Entrée',
  OUT: 'Sortie',
  TRANSFER: 'Transfert',
  RESERVATION: 'Réservation',
  RELEASE: 'Libération',
  ADJUSTMENT: 'Ajustement',
};

export const LOAD_KIND: Record<string, string> = {
  ROUTE: 'Tournée',
  CASH_VAN: 'Cash van',
  RELOAD: 'Rechargement',
};

/** Article affiché : produit, puis parfum s'il y en a un. */
export function articleLabel(a: { productName: string; variantName: string | null }): string {
  return a.variantName ? `${a.productName} ${a.variantName}` : a.productName;
}
