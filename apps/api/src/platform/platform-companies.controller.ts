import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { SALES_MODES, type SalesMode } from '@sellwasl/business-rules';
import {
  type CreateCompanyResponse,
  createCompanySchema,
  type PlatformCompany,
  type Page,
  platformCompaniesQuerySchema,
} from '@sellwasl/validation';
import { z } from 'zod';
import { notFound } from '../common/api-error';
import { paginate } from '../common/pagination';
import { CurrentPlatformUser, type PlatformPrincipal, PlatformOnly } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProvisioningService, toPlatformCompany } from '../companies/provisioning.service';
import { ModulesService } from '../modules/modules.service';
import { PrismaService } from '../prisma/prisma.service';

const changeModeSchema = z.object({ mode: z.enum(SALES_MODES) });

/** Entreprises vues par la plateforme (UC-90, docs/api.md §4). */
@PlatformOnly()
@Controller('platform/companies')
export class PlatformCompaniesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly provisioning: ProvisioningService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(platformCompaniesQuerySchema))
    q: z.output<typeof platformCompaniesQuerySchema>,
  ): Promise<Page<PlatformCompany>> {
    return paginate(
      q,
      (p) =>
        this.prisma.company.findMany({
          where: p.after,
          orderBy: p.orderBy,
          take: p.take,
          include: {
            companyModules: { where: { status: 'ACTIVE' } },
            _count: { select: { users: true } },
          },
        }),
      () => this.prisma.company.count(),
      (rows) =>
        rows.map((c) =>
          toPlatformCompany(
            c,
            c.companyModules.map((m) => m.moduleCode),
            c._count.users,
          ),
        ),
    );
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<PlatformCompany> {
    const c = await this.prisma.company.findUnique({
      where: { id },
      include: {
        companyModules: { where: { status: 'ACTIVE' } },
        _count: { select: { users: true } },
      },
    });
    if (!c) throw notFound('Entreprise introuvable.');
    return toPlatformCompany(
      c,
      c.companyModules.map((m) => m.moduleCode),
      c._count.users,
    );
  }

  /** Création : entreprise, mode, paramètres par défaut et compte administrateur (UC-90). */
  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createCompanySchema)) body: z.output<typeof createCompanySchema>,
    @CurrentPlatformUser() principal: PlatformPrincipal,
  ): Promise<CreateCompanyResponse> {
    return this.provisioning.createCompany(body, principal.platformUserId);
  }

  /** Changement de mode : refusé tant que du travail est en cours dans un module retiré (docs/modules.md §8). */
  @Post(':id/mode')
  @HttpCode(200)
  changeMode(
    @Param('id', ParseUUIDPipe) companyId: string,
    @Body(new ZodValidationPipe(changeModeSchema)) body: { mode: SalesMode },
    @CurrentPlatformUser() principal: PlatformPrincipal,
  ) {
    return this.modules.changeMode(companyId, body.mode, principal.platformUserId);
  }

  /** Suspension : plus aucun accès Web ni mobile ; réactivation : accès rétabli. */
  @Post(':id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() principal: PlatformPrincipal,
  ) {
    return this.setStatus(id, 'SUSPENDED', principal.platformUserId);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformUser() principal: PlatformPrincipal,
  ) {
    return this.setStatus(id, 'ACTIVE', principal.platformUserId);
  }

  private async setStatus(
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    platformUserId: string,
  ): Promise<PlatformCompany> {
    const before = await this.prisma.company.findUnique({ where: { id } });
    if (!before) throw notFound('Entreprise introuvable.');
    await this.prisma.$transaction([
      this.prisma.company.update({ where: { id }, data: { status } }),
      this.prisma.platformAuditLog.create({
        data: {
          id: uuidv7(),
          platformUserId,
          companyId: id,
          action: status === 'SUSPENDED' ? 'company.suspend' : 'company.reactivate',
          entity: 'Company',
          entityId: id,
          before: { status: before.status },
          after: { status },
        },
      }),
    ]);
    return this.get(id);
  }
}
