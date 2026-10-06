import { paymentNumber } from '@sellwasl/business-rules';
import type { OperationType } from '@sellwasl/validation';
import { ApiClientError } from '@/api/client';
import { secureStorage } from '@/auth/storage';
import { migrateLegacy, offlineEngine } from '@/offline/engine';

export { newId } from '@/offline/ids';

/**
 * Enregistre une action du terrain sur le téléphone, puis lance l'envoi sans l'attendre
 * (BR-SYN-01, phase 23) : elle part tout de suite s'il y a du réseau, sinon au retour du réseau.
 * L'opération porte un opId et un numéro d'ordre : renvoyée, elle n'est appliquée qu'une fois
 * (BR-SYN-02). Renvoie les données de l'action et son opId ; le résultat du serveur arrive par
 * la synchronisation (écran Synchronisation, vue locale).
 */
export async function sendOperation<T = Record<string, unknown>>(
  type: OperationType,
  payload: object,
  workdayId: string | null = null,
): Promise<T> {
  if (!(await secureStorage.getDeviceId()))
    throw new ApiClientError(0, 'NO_DEVICE', "Ce téléphone n'est pas associé.");
  await migrateLegacy();
  const op = await offlineEngine.enqueue(type, payload as Record<string, unknown>, workdayId);
  void offlineEngine.sync();
  return { ...payload, opId: op.opId } as T;
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

/** Numéro du prochain bon de livraison de ce téléphone : L01-B0042 (BR-IMP-04). */
export async function nextDeliveryNumber(userCode: string, series: string): Promise<string> {
  const next = (await secureStorage.getNumber('deliverySeq')) + 1;
  await secureStorage.setNumber('deliverySeq', next);
  return paymentNumber(userCode, series, next);
}
