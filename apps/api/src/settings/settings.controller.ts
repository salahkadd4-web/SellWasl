import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  companySettingsSchema,
  customerTypeSchema,
  holidaySchema,
  reasonSchema,
  warehouseSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

/** Paramétrage (docs/api.md §5.1) : lecture settings.read, écriture settings.update. */
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings.read')
  @Get('settings')
  current() {
    return this.settings.current();
  }

  @RequirePermission('settings.update')
  @Put('settings')
  update(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(companySettingsSchema))
    body: z.output<typeof companySettingsSchema>,
  ) {
    return this.settings.update(actor, body);
  }

  @RequirePermission('settings.read')
  @Get('customer-types')
  customerTypes() {
    return this.settings.customerTypes();
  }

  @RequirePermission('settings.update')
  @Post('customer-types')
  @HttpCode(201)
  createCustomerType(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(customerTypeSchema)) body: z.output<typeof customerTypeSchema>,
  ) {
    return this.settings.createCustomerType(actor, body);
  }

  @RequirePermission('settings.update')
  @Patch('customer-types/:id')
  updateCustomerType(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(customerTypeSchema.partial()))
    body: Partial<z.output<typeof customerTypeSchema>>,
  ) {
    return this.settings.updateCustomerType(actor, id, body);
  }

  @RequirePermission('settings.read')
  @Get('holidays')
  holidays() {
    return this.settings.holidays();
  }

  @RequirePermission('settings.update')
  @Post('holidays')
  @HttpCode(201)
  createHoliday(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(holidaySchema)) body: z.output<typeof holidaySchema>,
  ) {
    return this.settings.createHoliday(actor, body);
  }

  @RequirePermission('settings.update')
  @Delete('holidays/:id')
  @HttpCode(204)
  deleteHoliday(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.settings.deleteHoliday(actor, id);
  }

  @RequirePermission('settings.read')
  @Get('reasons')
  reasons() {
    return this.settings.reasons();
  }

  @RequirePermission('settings.update')
  @Post('reasons')
  @HttpCode(201)
  createReason(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.output<typeof reasonSchema>,
  ) {
    return this.settings.createReason(actor, body);
  }

  @RequirePermission('settings.update')
  @Patch('reasons/:id')
  updateReason(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reasonSchema.pick({ label: true, isActive: true }).partial()))
    body: { label?: string; isActive?: boolean },
  ) {
    return this.settings.updateReason(actor, id, body);
  }

  @RequirePermission('settings.read')
  @Get('warehouses')
  warehouses() {
    return this.settings.warehouses();
  }

  @RequirePermission('settings.update')
  @Post('warehouses')
  @HttpCode(201)
  createWarehouse(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(warehouseSchema)) body: z.output<typeof warehouseSchema>,
  ) {
    return this.settings.createWarehouse(actor, body);
  }

  @RequirePermission('settings.update')
  @Patch('warehouses/:id')
  updateWarehouse(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(warehouseSchema.partial()))
    body: Partial<z.output<typeof warehouseSchema>>,
  ) {
    return this.settings.updateWarehouse(actor, id, body);
  }
}
