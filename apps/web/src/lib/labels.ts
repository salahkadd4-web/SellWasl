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
  RETURNS_ANALYSIS: 'Analyse des retours',
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

export const ROUTE_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  DRAFT: { label: 'À lancer', tone: 'neutral' },
  PREPARING: { label: 'En préparation', tone: 'warning' },
  READY: { label: 'Prête à charger', tone: 'warning' },
  LOADED: { label: 'Chargée', tone: 'success' },
  OUT_FOR_DELIVERY: { label: 'En livraison', tone: 'success' },
  CLOSED: { label: 'Terminée', tone: 'neutral' },
};

/** Lendemain d'une date « AAAA-MM-JJ ». */
export function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** État constaté au déchargement (phase 21). */
export const CONDITION_LABELS: Record<string, string> = {
  RESTOCK: 'Remis en stock',
  DEFECTIVE: 'Défectueux',
  EXPIRED: 'Périmé',
  BROKEN: 'Cassé',
};

export const FACT_KIND_LABELS: Record<string, string> = {
  REFUSAL: 'Refus',
  RESALE: 'Revente en tournée',
  RETURN: 'Retour au déchargement',
  GAP: 'Écart au déchargement',
};

export const CONTEST_STATUS: Record<
  string,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  NONE: { label: 'Non contesté', tone: 'neutral' },
  CONTESTED: { label: 'Contesté', tone: 'warning' },
  UPHELD: { label: 'Contestation retenue', tone: 'success' },
  REJECTED: { label: 'Refus confirmé', tone: 'danger' },
};

/** Taux d'un indicateur : « 7,5 % », ou « volume insuffisant » sous le minimum. */
export function formatRate(r: { rate: number | null; insufficient: boolean }): string {
  if (r.rate === null) return r.insufficient ? 'Volume insuffisant' : '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(r.rate)} %`;
}

/** Date du jour décalée de `days` jours (négatif : dans le passé), au format AAAA-MM-JJ. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/** Statuts de la paie et de ses éléments (phase 21 bis). */
export const DISCREPANCY_STATUS: Record<string, { label: string; tone: Tone }> = {
  VALIDATED: { label: 'À analyser', tone: 'warning' },
  UNDER_REVIEW: { label: 'En analyse', tone: 'warning' },
  REJECTED: { label: 'Non fondé', tone: 'neutral' },
  RESOLVED: { label: 'Sans responsabilité', tone: 'success' },
  DEDUCTION_PENDING: { label: 'Retenue à approuver', tone: 'warning' },
  DEDUCTION_APPROVED: { label: 'Retenue approuvée', tone: 'danger' },
  DEDUCTION_APPLIED: { label: 'Retenue appliquée', tone: 'neutral' },
};
export const ADVANCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Demandé', tone: 'warning' },
  APPROVED: { label: 'Approuvé', tone: 'success' },
  REJECTED: { label: 'Refusé', tone: 'danger' },
  PAID: { label: 'Payé', tone: 'success' },
  DEDUCTED: { label: 'Déduit de la paie', tone: 'neutral' },
};
export const DEDUCTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'À approuver', tone: 'warning' },
  APPROVED: { label: 'Approuvée', tone: 'success' },
  REJECTED: { label: 'Refusée', tone: 'danger' },
  APPLIED: { label: 'Appliquée', tone: 'neutral' },
};
export const DEDUCTION_SOURCE: Record<string, string> = {
  STOCK_DISCREPANCY: 'Écart de stock',
  FINANCIAL_DISCREPANCY: 'Écart de caisse',
  OTHER: 'Autre',
};
export const INCENTIVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  CALCULATED: { label: 'À vérifier', tone: 'warning' },
  VALIDATED: { label: 'Validée', tone: 'success' },
  REJECTED: { label: 'Refusée', tone: 'danger' },
  APPLIED: { label: 'Payée en paie', tone: 'neutral' },
};
export const INCENTIVE_KIND: Record<string, string> = {
  PER_UNIT: 'Par unité',
  PERCENT_REVENUE: 'Pourcentage du CA',
  THRESHOLD: 'Seuil',
  TIERED: 'Paliers',
  REVENUE_TARGET: 'Objectif de CA',
};
export const PAYROLL_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Brouillon', tone: 'neutral' },
  CALCULATED: { label: 'Calculée', tone: 'warning' },
  APPROVED: { label: 'Approuvée', tone: 'success' },
  PAID: { label: 'Payée', tone: 'success' },
  CLOSED: { label: 'Clôturée', tone: 'neutral' },
};
export const PAY_LINE_KIND: Record<string, string> = {
  BASE_SALARY: 'Salaire de base',
  INCENTIVE: 'Prime',
  OBJECTIVE_BONUS: 'Objectif',
  DRIVER_BONUS: 'Objectif livreur',
  ADJUSTMENT: 'Ajustement',
  ADVANCE: 'Acompte',
  DEDUCTION: 'Retenue',
};

/** Mois AAAA-MM lisible : « août 2027 ». */
export function formatMonth(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString('fr-DZ', {
    month: 'long',
    year: 'numeric',
  });
}
