import 'reflect-metadata';
import { initSentry } from './common/sentry';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

// Sentry avant l'application, comme le demande son SDK ; inactif sans SENTRY_DSN (phase 27)
initSentry();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const port = app.get(ConfigService).getOrThrow<number>('API_PORT');
  await app.listen(port);
}

void bootstrap();
