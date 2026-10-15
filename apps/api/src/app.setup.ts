import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { webProxyClientIpMiddleware } from './common/client-ip';
import { mountDocs } from './docs/docs';

/**
 * Les montants (dinars) et curseurs de synchronisation sont des BigInt en base : ils partent en
 * nombres JSON (docs/api.md §1). Ils restent loin de Number.MAX_SAFE_INTEGER (9 × 10^15).
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** Configuration commune à l'application et aux tests d'intégration. */
export function configureApp(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.set('json replacer', bigintReplacer);
  // IP réelle du client derrière les proxys de confiance (phase 27) ; 0 : X-Forwarded-For ignoré
  const trustProxy = Number(process.env.TRUST_PROXY ?? 0);
  if (Number.isInteger(trustProxy) && trustProxy > 0) server.set('trust proxy', trustProxy);
  // Requêtes transmises par le Web : adresse du client posée par lui, avec la clé partagée (phase 30)
  app.use(webProxyClientIpMiddleware(process.env.WEB_PROXY_SECRET));
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  // Documentation OpenAPI : /api/docs, jamais en production (docs/api.md §1, phase 25)
  mountDocs(app);
  app.enableShutdownHooks();
}
