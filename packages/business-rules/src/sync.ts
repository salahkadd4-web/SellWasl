// Envoi des opérations du téléphone (docs/api.md §6) : reconnaître une action déjà partie.

interface Action {
  type: string;
  payload: unknown;
}

/** Champs créés à chaque essai par le téléphone : ils ne distinguent pas deux actions. */
const GENERATED_FIELDS = new Set(['paymentId', 'visitId', 'number']);

function signature(action: Action): string {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  // Pour une création de client, son identifiant est lui aussi créé à chaque essai
  const generated = (key: string) =>
    GENERATED_FIELDS.has(key) || (action.type === 'customer.create' && key === 'customerId');
  const kept = Object.keys(payload)
    .filter((key) => !generated(key))
    .sort()
    .map((key) => [key, payload[key]]);
  return JSON.stringify([action.type, kept]);
}

/**
 * Deux envois de la même action du vendeur : même type et mêmes données, hors identifiants et
 * numéros créés à chaque essai. Sert à ne pas refaire une action dont la réponse s'est perdue.
 */
export function isSameAction(a: Action, b: Action): boolean {
  return signature(a) === signature(b);
}
