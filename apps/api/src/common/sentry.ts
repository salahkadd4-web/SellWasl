import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent } from '@sentry/nestjs';

/** En-têtes jamais envoyés à Sentry. */
const SECRET_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-forwarded-for',
  'idempotency-key',
];

/**
 * Nettoie un événement avant l'envoi (phase 27, docs/security.md) : ni corps de requête, ni
 * cookies, ni paramètres d'URL, ni en-têtes d'authentification ; l'utilisateur réduit à son
 * identifiant, sans e-mail, nom ni IP.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers)
      for (const name of Object.keys(event.request.headers))
        if (SECRET_HEADERS.includes(name.toLowerCase())) delete event.request.headers[name];
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  delete event.extra;
  return event;
}

/** Démarre Sentry si SENTRY_DSN est renseignée ; sans elle, rien n'est envoyé. */
export function initSentry(env: Record<string, string | undefined> = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}

/** Erreur inattendue (500) : envoyée avec l'identifiant de requête, l'entreprise et l'utilisateur. */
export function reportError(
  exception: unknown,
  context: { requestId?: string; companyId?: string; userId?: string },
): void {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    if (context.requestId) scope.setTag('requestId', context.requestId);
    if (context.companyId) scope.setTag('companyId', context.companyId);
    if (context.userId) scope.setUser({ id: context.userId });
    Sentry.captureException(exception);
  });
}
