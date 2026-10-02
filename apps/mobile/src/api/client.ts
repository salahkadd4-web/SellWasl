const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3001';

export interface HealthResponse {
  status: 'ok';
  database: 'ok';
  time: string;
}

/** Vérifie que l'API et la base répondent (critère de validation de la phase 2). */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/api/v1/health`);
  if (!response.ok) {
    throw new Error(`API indisponible (HTTP ${response.status})`);
  }
  return (await response.json()) as HealthResponse;
}
