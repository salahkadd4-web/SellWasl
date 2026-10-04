import { paymentNumber } from '@sellwasl/business-rules';
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

  // Une action précédente est partie sans réponse : on la renvoie d'abord, sans en créer une autre,
  // pour qu'un nouvel essai du vendeur ne la fasse pas deux fois.
  const pending = await secureStorage.getPendingOp();
  if (pending) {
    try {
      await push(deviceId, JSON.parse(pending) as SyncOperationInput);
    } catch (error) {
      if (isNetwork(error)) throw new ApiClientError(0, 'NETWORK', NO_NETWORK);
      throw error;
    }
    await secureStorage.setPendingOp(null);
    throw new ApiClientError(
      0,
      'RESENT',
      "Votre action précédente vient d'être envoyée. Vérifiez l'écran avant de recommencer.",
    );
  }

  const send = async (deviceSeq: number): Promise<SyncResult> => {
    const op: SyncOperationInput = {
      opId: newId(),
      deviceSeq,
      type,
      occurredAt: new Date().toISOString(),
      workdayId,
      payload,
    };
    await secureStorage.setNumber('deviceSeq', deviceSeq);
    await secureStorage.setPendingOp(JSON.stringify(op));
    try {
      const result = await push(deviceId, op);
      await secureStorage.setPendingOp(null);
      return result;
    } catch (error) {
      if (isNetwork(error)) throw new ApiClientError(0, 'NETWORK', NO_NETWORK);
      await secureStorage.setPendingOp(null);
      throw error;
    }
  };

  let result = await send((await secureStorage.getNumber('deviceSeq')) + 1);
  // Numérotation décalée (réinstallation, réponse perdue) : on se recale une fois sur le serveur
  const expected = result.result?.expectedDeviceSeq;
  if (
    (result.status === 'GAP' || result.error?.code === 'DUPLICATE') &&
    typeof expected === 'number'
  )
    result = await send(expected);

  if (result.status === 'APPLIED' || result.status === 'APPLIED_WITH_CHANGES')
    return (result.result ?? {}) as T;
  throw new ApiClientError(
    409,
    result.error?.code ?? 'REJECTED',
    result.error?.message ?? 'Action refusée par le serveur.',
  );
}

/** Numéro du prochain reçu de dette de ce téléphone : V07-B0042 (ARC-11). */
export async function nextReceiptNumber(userCode: string, series: string): Promise<string> {
  const next = (await secureStorage.getNumber('receiptSeq')) + 1;
  await secureStorage.setNumber('receiptSeq', next);
  return paymentNumber(userCode, series, next);
}
