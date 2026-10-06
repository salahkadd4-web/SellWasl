export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3001';

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

let refreshHandler: (() => Promise<boolean>) | null = null;
/** Renouvelle le jeton d'accès expiré (15 min) avec le jeton de rafraîchissement. */
export function setRefreshHandler(handler: (() => Promise<boolean>) | null): void {
  refreshHandler = handler;
}

/** Appel à l'API ; les erreurs gardent le code de docs/api.md §2. */
export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  // Un envoi de fichier (FormData) garde le type multipart que fixe fetch
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiClientError(0, 'NETWORK', 'Serveur injoignable. Vérifiez la connexion.');
  }
  if (response.status === 401 && retry && refreshHandler && !path.startsWith('/auth/')) {
    if (await refreshHandler()) return request<T>(path, init, false);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      response.status,
      body?.error?.code ?? 'ERROR',
      body?.error?.message ?? 'Erreur inattendue. Réessayez.',
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export interface HealthResponse {
  status: 'ok';
  database: 'ok';
  time: string;
}

/** Vérifie que l'API et la base répondent. */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}
