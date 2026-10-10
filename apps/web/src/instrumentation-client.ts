import * as Sentry from '@sentry/nextjs';
import { scrubEvent } from '@/lib/sentry-scrub';

// Erreurs du navigateur envoyées à Sentry quand NEXT_PUBLIC_SENTRY_DSN est renseignée (phase 27)
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn)
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
