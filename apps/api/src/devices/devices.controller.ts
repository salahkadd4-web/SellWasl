import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type ActivationCodeResponse,
  type FieldUserDevice,
  type HeartbeatResponse,
  heartbeatSchema,
  pushTokenSchema,
  type UserDevicesResponse,
} from '@sellwasl/validation';
import type { z } from 'zod';
import {
  AnyAuthenticated,
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DevicesService } from './devices.service';

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @RequirePermission('devices.read')
  @Get('devices')
  list(): Promise<FieldUserDevice[]> {
    return this.devices.listFieldUsers();
  }

  @RequirePermission('devices.read')
  @Get('users/:id/devices')
  userDevices(@Param('id', ParseUUIDPipe) userId: string): Promise<UserDevicesResponse> {
    return this.devices.userDevices(userId);
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

  @RequirePermission('devices.revoke')
  @Post('devices/:id/block')
  @HttpCode(204)
  block(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.devices.block(user, deviceId);
  }

  @RequirePermission('devices.revoke')
  @Post('devices/:id/unblock')
  @HttpCode(204)
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.devices.unblock(user, deviceId);
  }

  @RequirePermission('devices.revoke')
  @Post('sessions/:id/revoke')
  @HttpCode(204)
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    return this.devices.revokeSession(user, sessionId);
  }

  @RequirePermission('devices.revoke')
  @Post('users/:id/sessions/revoke')
  @HttpCode(204)
  revokeUserSessions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.devices.revokeUserSessions(user, userId);
  }

  /** Signal de vie du téléphone connecté (architecture §11.3). */
  @AnyAuthenticated()
  @Post('devices/heartbeat')
  @HttpCode(200)
  heartbeat(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(heartbeatSchema)) body: z.output<typeof heartbeatSchema>,
  ): Promise<HeartbeatResponse> {
    return this.devices.heartbeat(user, body);
  }

  @AnyAuthenticated()
  @Put('devices/push-token')
  @HttpCode(204)
  pushToken(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(pushTokenSchema)) body: z.output<typeof pushTokenSchema>,
  ): Promise<void> {
    return this.devices.setPushToken(user, body.pushToken);
  }
}
