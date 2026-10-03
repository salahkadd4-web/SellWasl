import { Controller, Get } from '@nestjs/common';
import type { ModuleCode } from '@sellwasl/business-rules';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';

@Controller('modules')
export class ModulesController {
  @RequirePermission('modules.read')
  @Get()
  list(@CurrentUser() user: AuthUser): { modules: readonly ModuleCode[] } {
    return { modules: user.modules };
  }
}
