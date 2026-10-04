import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { ModulesModule } from './modules/modules.module';
import { CatalogModule } from './catalog/catalog.module';
import { FilesModule } from './files/files.module';
import { CustomersModule } from './customers/customers.module';
import { TerritoriesModule } from './territories/territories.module';
import { PlanningModule } from './planning/planning.module';
import { SyncModule } from './sync/sync.module';
import { FieldModule } from './field/field.module';
import { SupervisionModule } from './supervision/supervision.module';
import { AdminModule } from './settings/admin.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      // Syntaxe de route d'Express 5 : évite l'avertissement « Unsupported route path ».
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        transport:
          process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined
            ? { target: 'pino-pretty', options: { singleLine: true, ignore: 'pid,hostname' } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        // Une ligne par requête : méthode, URL, statut, durée.
        serializers: {
          req: (req: { id: unknown; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    // Limite par défaut : 300 requêtes par minute ; les routes de connexion sont plus strictes.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    // Contexte de chaque requête : l'entreprise de l'utilisateur, lue par le client filtré (phase 5).
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    TenancyModule,
    ModulesModule,
    AuditModule,
    AuthModule,
    AdminModule,
    FilesModule,
    CustomersModule,
    CatalogModule,
    TerritoriesModule,
    PlanningModule,
    SyncModule,
    FieldModule,
    SupervisionModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
