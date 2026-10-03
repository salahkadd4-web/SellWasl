'use client';

/**
 * Client de l'API pour le Web (architecture §8) : jeton d'accès en mémoire, jamais dans le stockage
 * du navigateur ; jeton de rafraîchissement dans un cookie HttpOnly posé par l'API.
 */
export type Scope = 'company' | 'platform';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown, fallback = 'Erreur inattendue. Réessayez.'): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

const tokens: Record<Scope, string | null> = { company: null, platform: null };
const refreshing: Record<Scope, Promise<boolean> | null> = { company: null, platform: null };
const REFRESH_PATH: Record<Scope, string> = {
  company: '/api/v1/auth/refresh',
  platform: '/api/v1/platform/auth/refresh',
};

export function setAccessToken(scope: Scope, token: string | null): void {
  tokens[scope] = token;
}

async function toError(response: Response): Promise<ApiClientError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  } | null;
  return new ApiClientError(
    response.status,
    body?.error?.code ?? 'ERROR',
    body?.error?.message ?? 'Erreur inattendue. Réessayez.',
    body?.error?.details,
  );
}

/** Un seul rafraîchissement à la fois, même si plusieurs requêtes échouent ensemble. */
export function refreshSession(scope: Scope): Promise<boolean> {
  refreshing[scope] ??= (async () => {
    try {
      const response = await fetch(REFRESH_PATH[scope], {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        tokens[scope] = null;
        return false;
      }
      const data = (await response.json()) as { accessToken: string };
      tokens[scope] = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshing[scope] = null;
    }
  })();
  return refreshing[scope];
}

export async function api<T>(
  scope: Scope,
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (tokens[scope]) headers.set('Authorization', `Bearer ${tokens[scope]}`);

  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401 && retry && !path.includes('/auth/')) {
    if (await refreshSession(scope)) return api<T>(scope, path, init, false);
  }
  if (!response.ok) throw await toError(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}
