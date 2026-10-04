import { isSameAction, paymentNumber } from '@sellwasl/business-rules';
import type {
  OperationType,
  SyncOperationInput,
  SyncPushResponse,
  SyncResult,
} from '@sellwasl/validation';
import { getRandomBytes } from 'expo-crypto';
import { ApiClientError, request } from '@/api/client';
import { secureStorage } from '@/auth/storage';

/** UUID v7 (RFC 9562), comme sur le serveur : identifiants créés par le téléphone. */
export function newId(now: number = Date.now()): string {
  const bytes = getRandomBytes(16);
  let ts = now;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const NO_NETWORK = 'Réseau nécessaire pour cette action.';

async function push(deviceId: string, op: SyncOperationInput): Promise<SyncResult> {
  const reply = await request<SyncPushResponse>('/sync/push', {
    method: 'POST',
    body: JSON.stringify({ deviceId, operations: [op] }),
  });
  return reply.results[0]!;
}

function isNetwork(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'NETWORK';
}

/**
 * Sans réponse lisible (réseau coupé, erreur 5xx d'un proxy), le serveur a peut-être appliqué
 * l'opération : on la garde pour la renvoyer telle quelle. Une erreur 4xx ne passera jamais.
 */
function mayHaveApplied(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 0 || error.status >= 500);
}

const applied = (r: SyncResult) => r.status === 'APPLIED' || r.status === 'APPLIED_WITH_CHANGES';

const TYPE_LABELS: Record<string, string> = {
  'workday.start': 'démarrage de la journée',
  'workday.close': 'clôture de la journée',
  'visit.start': 'début de visite',
  'visit.close_no_order': 'clôture de visite',
  'customer.create': 'nouveau client',
  'payment.debt': 'encaissement',
};

/**
 * Envoie l'opération en la gardant comme « en attente » jusqu'à une réponse lisible ; recale une
 * fois le numéro d'ordre sur celui qu'attend le serveur (réinstallation, réponse perdue).
 */
async function deliver(deviceId: string, base: SyncOperationInput): Promise<SyncResult> {
  let op = base;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await secureStorage.setNumber('deviceSeq', op.deviceSeq);
    await secureStorage.setPendingOp(JSON.stringify(op));
    let result: SyncResult;
    try {
      result = await push(deviceId, op);
    } catch (error) {
      if (isNetwork(error)) throw new ApiClientError(0, 'NETWORK', NO_NETWORK);
      if (!mayHaveApplied(error)) await secureStorage.setPendingOp(null);
      throw error;
    }
    await secureStorage.setPendingOp(null);
    const expected = result.result?.expectedDeviceSeq;
    const outOfOrder = result.status === 'GAP' || result.error?.code === 'DUPLICATE';
    if (!(outOfOrder && typeof expected === 'number' && attempt === 0)) return result;
    op = { ...op, deviceSeq: expected };
  }
  throw new ApiClientError(409, 'GAP', 'Numérotation des opérations décalée. Réessayez.');
}

/**
 * Envoie une action du vendeur au serveur, tout de suite (phase 15, en ligne d'abord).
 * L'opération porte un opId et un numéro d'ordre : renvoyée après une coupure, elle n'est
 * appliquée qu'une fois (BR-SYN-02). Ce module deviendra la file d'envoi hors connexion
 * (phase 23).
 */
export async function sendOperation<T = Record<string, unknown>>(
  type: OperationType,
  payload: object,
  workdayId: string | null = null,
): Promise<T> {
  const deviceId = await secureStorage.getDeviceId();
  if (!deviceId) throw new ApiClientError(0, 'NO_DEVICE', "Ce téléphone n'est pas associé.");

  // Une action précédente est partie sans réponse : on la renvoie d'abord, telle quelle.
  const stored = await secureStorage.getPendingOp();
  if (stored) {
    const previous = JSON.parse(stored) as SyncOperationInput;
    let resent: SyncResult | null = null;
    try {
      resent = await deliver(deviceId, previous);
    } catch (error) {
      if (mayHaveApplied(error)) throw error;
      // Refusée sans appel possible (4xx) : abandonnée, l'action du vendeur suit
    }
    if (resent && applied(resent)) {
      // Le vendeur refait la même action : c'est celle-là qui vient d'aboutir, on ne la refait pas
      if (isSameAction(previous, { type, payload })) return (resent.result ?? {}) as T;
      throw new ApiClientError(
        0,
        'RESENT',
        `Votre action précédente (${TYPE_LABELS[previous.type] ?? previous.type}) vient d'être enregistrée. Vérifiez l'écran puis recommencez si besoin.`,
      );
    }
  }

  const result = await deliver(deviceId, {
    opId: newId(),
    deviceSeq: (await secureStorage.getNumber('deviceSeq')) + 1,
    type,
    occurredAt: new Date().toISOString(),
    workdayId,
    payload,
  });
  if (applied(result)) return (result.result ?? {}) as T;
  throw new ApiClientError(
    409,
    result.error?.code ?? 'REJECTED',
    result.error?.message ?? 'Action refusée par le serveur.',
  );
}

/** Numéro de la prochaine commande de ce téléphone : V07-B0042 (BR-CMD-07). */
export async function nextOrderNumber(userCode: string, series: string): Promise<string> {
  const next = (await secureStorage.getNumber('orderSeq')) + 1;
  await secureStorage.setNumber('orderSeq', next);
  return paymentNumber(userCode, series, next);
}

/** Numéro du prochain reçu de dette de ce téléphone : V07-B0042 (ARC-11). */
export async function nextReceiptNumber(userCode: string, series: string): Promise<string> {
  const next = (await secureStorage.getNumber('receiptSeq')) + 1;
  await secureStorage.setNumber('receiptSeq', next);
  return paymentNumber(userCode, series, next);
}
