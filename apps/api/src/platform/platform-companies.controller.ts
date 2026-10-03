import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { SALES_MODES, type SalesMode } from '@sellwasl/business-rules';
import { z } from 'zod';
import { CurrentPlatformUser, type PlatformPrincipal, PlatformOnly } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ModulesService } from '../modules/modules.service';
import { PrismaService } from '../prisma/prisma.service';

const changeModeSchema = z.object({ mode: z.enum(SALES_MODES) });

/** Entreprises vues par la plateforme ; la gestion complète arrive en phase 8. */
@PlatformOnly()
@Controller('platform/companies')
export class PlatformCompaniesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
  ) {}

  @Get()
  async list() {
    const companies = await this.prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        companyModules: { where: { status: 'ACTIVE' } },
        _count: { select: { users: true } },
      },
    });
    return companies.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      mode: c.mode,
      status: c.status,
      modules: c.companyModules.map((m) => m.moduleCode),
      users: c._count.users,
    }));
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
}
