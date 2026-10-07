/**
 * Idempotency-Key des créations d'argent et de stock (api.md §1, phase 25) : une clé par action,
 * gardée jusqu'au succès. Un double clic ou un nouvel essai après une coupure réutilise la même
 * clé : le serveur ne crée qu'une fois.
 */
const keys = new Map<string, string>();

/** En-tête de l'action `scope` (par exemple « settlement:<journée> »). */
export function idempotencyKey(scope: string): Record<string, string> {
  let key = keys.get(scope);
  if (!key) {
    key = crypto.randomUUID();
    keys.set(scope, key);
  }
  return { 'Idempotency-Key': key };
}

/** Action réussie : la prochaine fois sera une nouvelle création. */
export function idempotencyDone(scope: string): void {
  keys.delete(scope);
}
