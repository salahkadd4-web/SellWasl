import { newId } from '@/offline/ids';

/**
 * Idempotency-Key des créations de stock du magasinier (api.md §1, phase 25) : une clé par action,
 * gardée jusqu'au succès ; un double appui ou un nouvel essai réutilise la même clé.
 */
const keys = new Map<string, string>();

export function idempotencyKey(scope: string): Record<string, string> {
  let key = keys.get(scope);
  if (!key) {
    key = newId();
    keys.set(scope, key);
  }
  return { 'Idempotency-Key': key };
}

export function idempotencyDone(scope: string): void {
  keys.delete(scope);
}
