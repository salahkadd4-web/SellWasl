import { Global, Module } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma/prisma.service';
import { createTenantPrisma, TENANT_PRISMA } from './tenant-prisma';

/**
 * Accès aux données métier : les services injectent TENANT_PRISMA.
 * PrismaService (sans filtre) est réservé à l'authentification, à la plateforme et aux tâches
 * système ; un test vérifie la liste des fichiers qui l'utilisent.
 */
@Global()
@Module({
  providers: [
    {
      provide: TENANT_PRISMA,
      inject: [PrismaService, ClsService],
      useFactory: (prisma: PrismaService, cls: ClsService) => createTenantPrisma(prisma, cls),
    },
  ],
  exports: [TENANT_PRISMA],
})
export class TenancyModule {}
