import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { RoleCode } from '@sellwasl/business-rules';
import {
  type CompanyUser,
  createUserSchema,
  type TemporaryPasswordResponse,
  updateUserSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('users.read')
  @Get('users')
  list(): Promise<CompanyUser[]> {
    return this.users.list();
  }

  @RequirePermission('users.read')
  @Get('roles')
  roles(@CurrentUser() actor: AuthUser) {
    return this.users.roles(actor);
  }

  @RequirePermission('users.create')
  @Post('users')
  @HttpCode(201)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.create(actor, { ...body, role: body.role as RoleCode });
  }

  @RequirePermission('users.update')
  @Patch('users/:id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: z.output<typeof updateUserSchema>,
  ): Promise<CompanyUser> {
    return this.users.update(actor, id, body);
  }

  @RequirePermission('users.disable')
  @Post('users/:id/disable')
  @HttpCode(200)
  disable(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompanyUser> {
    return this.users.setStatus(actor, id, 'DISABLED');
  }

  @RequirePermission('users.disable')
  @Post('users/:id/enable')
  @HttpCode(200)
  enable(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CompanyUser> {
    return this.users.setStatus(actor, id, 'ACTIVE');
  }

  @RequirePermission('users.update')
  @Post('users/:id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemporaryPasswordResponse> {
    return this.users.resetPassword(actor, id);
  }
}
