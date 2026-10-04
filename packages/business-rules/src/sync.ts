// Envoi des opérations du téléphone (docs/api.md §6) : reconnaître une action déjà partie.

interface Action {
  type: string;
  payload: unknown;
}

/**
 * Champs créés par le téléphone à chaque essai, par type d'opération : ils ne distinguent pas deux
 * envois de la même action. Ailleurs, le même nom désigne la cible (la visite d'une commande).
 */
const GENERATED_FIELDS: Record<string, readonly string[]> = {
  'workday.start': ['workdayId'],
  'visit.start': ['visitId'],
  'customer.create': ['customerId'],
  'payment.debt': ['paymentId', 'number'],
  'order.confirm': ['orderId', 'number'],
};

function signature(action: Action): string {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const generated = GENERATED_FIELDS[action.type] ?? [];
  const kept = Object.keys(payload)
    .filter((key) => !generated.includes(key))
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
