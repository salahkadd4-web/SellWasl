import type { ErrorEvent } from '@sentry/nextjs';

/** En-têtes jamais envoyés à Sentry. */
const SECRET_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-forwarded-for'];

/**
 * Nettoie un événement avant l'envoi (phase 27, docs/security.md), comme l'API : ni corps, ni
 * cookies, ni paramètres d'URL, ni en-têtes d'authentification ; l'utilisateur réduit à son
 * identifiant.
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
