import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { ActivationCodeResponse } from '@sellwasl/validation';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { DevicesService, type FieldUserDevice } from './devices.service';

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequirePermission('devices.read')
  @Get('devices')
  list(): Promise<FieldUserDevice[]> {
    return this.devices.listFieldUsers();
  }

  @RequirePermission('devices.associate')
  @Post('users/:id/activation-codes')
  @HttpCode(201)
  createCode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<ActivationCodeResponse> {
    return this.devices.createActivationCode(user, userId);
  }

  @RequirePermission('devices.revoke')
  @Post('devices/:id/revoke')
  @HttpCode(204)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.devices.revoke(user, deviceId);
  }
}
