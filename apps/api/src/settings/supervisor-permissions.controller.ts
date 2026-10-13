import { Body, Controller, Get, Put } from '@nestjs/common';
import { supervisorPermissionsSchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SupervisorPermissionsService } from './supervisor-permissions.service';

/** Permissions du superviseur (docs/rbac.md §7 bis) : réglées par l'administrateur seul. */
@Controller('roles/supervisor/permissions')
export class SupervisorPermissionsController {
  constructor(private readonly permissions: SupervisorPermissionsService) {}

  @RequirePermission('roles.manage')
  @Get()
  get() {
    return this.permissions.get();
  }

  @RequirePermission('roles.manage')
  @Put()
  update(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(supervisorPermissionsSchema))
    body: z.output<typeof supervisorPermissionsSchema>,
  ) {
    return this.permissions.update(actor, body.permissions);
  }
}
