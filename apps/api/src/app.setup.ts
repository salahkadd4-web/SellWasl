import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** Configuration commune à l'application et aux tests d'intégration. */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
}
