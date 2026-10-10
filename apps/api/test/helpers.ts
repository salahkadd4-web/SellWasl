import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { totpCode } from '../src/auth/totp';
import { DataCipher } from '../src/common/crypto';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'SellWasl@2026';

export interface TestApp {
  app: INestApplication;
  url: string;
  close(): Promise<void>;
}

/** Démarre l'API complète sur un port libre, avec des contrôleurs de test éventuels. */
export async function startApp(extraControllers: Type[] = []): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  return { app, url: `http://127.0.0.1:${address.port}/api/v1`, close: () => app.close() };
}

export interface Reply<T = unknown> {
  status: number;
  body: T & { error?: { code: string; message: string } };
}

export async function call<T = unknown>(
  base: string,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Reply<T>> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Reply<T>['body'] };
}

export async function webLogin(base: string, companyCode: string, login: string): Promise<string> {
  const reply = await call<{ accessToken: string }>(base, 'POST', '/auth/login', {
    body: { companyCode, login, password: PASSWORD },
  });
  if (reply.status !== 200) throw new Error(`Connexion ${login} : ${JSON.stringify(reply.body)}`);
  return reply.body.accessToken;
}

export const PLATFORM_EMAIL = 'superadmin@sellwasl.test';

/**
 * Connexion du Super Admin avec son deuxième facteur (phase 27) : enrôle le compte s'il ne l'est
 * pas, sinon calcule le code depuis le secret. Le dernier pas utilisé est effacé avant : les tests
 * se connectent plusieurs fois dans le même pas de 30 s (le rejeu est testé dans security.test.ts).
 */
export async function platformLogin(t: TestApp): Promise<string> {
  const prisma = t.app.get(PrismaService);
  await prisma.platformUser.update({
    where: { email: PLATFORM_EMAIL },
    data: { totpLastStep: null },
  });
  const body = { email: PLATFORM_EMAIL, password: PASSWORD };
  const first = await call<{ accessToken: string }>(t.url, 'POST', '/platform/auth/login', {
    body,
  });
  const details = (first.body.error as { details?: { secret?: string } } | undefined)?.details;
  const secret =
    details?.secret ??
    t.app
      .get(DataCipher)
      .decrypt(
        (await prisma.platformUser.findUniqueOrThrow({ where: { email: PLATFORM_EMAIL } }))
          .totpSecret!,
      );
  const reply = await call<{ accessToken: string }>(t.url, 'POST', '/platform/auth/login', {
    body: { ...body, code: totpCode(secret, Math.floor(Date.now() / 30_000)) },
  });
  if (reply.status !== 200) throw new Error(`Connexion plateforme : ${JSON.stringify(reply.body)}`);
  return reply.body.accessToken;
}
