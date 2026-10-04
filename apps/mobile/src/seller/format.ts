/** 184500 → « 184 500 DA ». */
export function formatDA(amount: number): string {
  return `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} DA`;
}

/** 850 → « 850 m » ; 2300 → « 2,3 km ». */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}

/** Message d'une erreur d'action, affichable tel quel. */
export function errorMessage(error: unknown, fallback = 'Action impossible. Réessayez.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: 'Chaque semaine',
  BIWEEKLY: 'Tous les 15 jours',
  EVERY_4_WEEKS: 'Toutes les 4 semaines',
};

export const VISIT_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Prévue',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminée',
  MISSED: 'Manquée',
};

/** 2026-10-03 → 03/10/2026. */
export function formatDate(date: string): string {
  return date.slice(0, 10).split('-').reverse().join('/');
}
