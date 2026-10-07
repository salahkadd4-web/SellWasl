import { Logger } from '@nestjs/common';

/** Message push vers un téléphone (jeton Expo). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/** Résultat d'un message ; `error: 'DeviceNotRegistered'` : jeton à oublier. */
export interface PushResult {
  ok: boolean;
  error?: string;
}

/**
 * Fournisseur push remplaçable (architecture §15.2) : Expo Push en production ; FCM direct,
 * email ou autre canal pourront prendre sa place derrière la même interface.
 */
export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo Push Service : il relaie vers Firebase Cloud Messaging (Android). */
export class ExpoPushProvider implements PushProvider {
  private readonly logger = new Logger('ExpoPushProvider');

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN)
      headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    try {
      const response = await fetch(EXPO_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { status: 'ok' | 'error'; details?: { error?: string } }[];
      } | null;
      if (!response.ok || !body?.data) {
        this.logger.warn(`Envoi push refusé : HTTP ${response.status}`);
        return messages.map(() => ({ ok: false, error: `HTTP_${response.status}` }));
      }
      return body.data.map((r) =>
        r.status === 'ok' ? { ok: true } : { ok: false, error: r.details?.error ?? 'ERROR' },
      );
    } catch (error) {
      this.logger.warn(`Envoi push impossible : ${String(error)}`);
      return messages.map(() => ({ ok: false, error: 'NETWORK' }));
    }
  }
}

/** Tests et développement : messages gardés en mémoire ; jetons « morts » simulés. */
export class MemoryPushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];
  readonly dead = new Set<string>();

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    return messages.map((m) => {
      if (this.dead.has(m.to)) return { ok: false, error: 'DeviceNotRegistered' };
      this.sent.push(m);
      return { ok: true };
    });
  }
}

/** `PUSH_PROVIDER=memory` : tests et développement sans Firebase. */
export function pushProviderFactory(): PushProvider {
  return process.env.PUSH_PROVIDER === 'memory' ? new MemoryPushProvider() : new ExpoPushProvider();
}
