import { HttpError, NetworkError, type PullQuery, type Transport } from '@sellwasl/offline';
import type { SyncOperationInput, SyncPullResponse, SyncPushResponse } from '@sellwasl/validation';
import { ApiClientError, request } from '@/api/client';
import { secureStorage } from '@/auth/storage';

/** Erreurs du client HTTP au format du moteur hors connexion. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.code === 'NETWORK' || error.status === 0) throw new NetworkError(error.message);
      throw new HttpError(error.status, error.code, error.message);
    }
    throw error;
  }
}

/** POST /sync/push et GET /sync/pull (docs/api.md §6). */
export const httpTransport: Transport = {
  async push(operations: SyncOperationInput[]): Promise<SyncPushResponse> {
    const deviceId = await secureStorage.getDeviceId();
    if (!deviceId) throw new HttpError(403, 'NO_DEVICE', "Ce téléphone n'est pas associé.");
    return call(() =>
      request<SyncPushResponse>('/sync/push', {
        method: 'POST',
        body: JSON.stringify({ deviceId, operations }),
      }),
    );
  },
  pull(query: PullQuery): Promise<SyncPullResponse> {
    const params = new URLSearchParams({ cursor: query.cursor, date: query.date });
    if (query.scope !== undefined) params.set('scope', query.scope);
    if (query.page) params.set('page', query.page);
    return call(() => request<SyncPullResponse>(`/sync/pull?${params.toString()}`));
  },
};
