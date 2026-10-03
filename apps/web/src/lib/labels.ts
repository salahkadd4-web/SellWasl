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
