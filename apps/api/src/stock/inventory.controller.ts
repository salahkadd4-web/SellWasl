import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  createInventorySchema,
  type InventoryDto,
  type InventoryResult,
  inventoryLinesSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Idempotent } from '../common/idempotency';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InventoryService } from './inventory.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Inventaire du dépôt (UC-44, phase 17). */
@Controller('inventories')
export class InventoryController {
  constructor(private readonly inventories: InventoryService) {}

  @RequirePermission('stock.read')
  @Get()
  list(): Promise<InventoryDto[]> {
    return this.inventories.list();
  }

  @RequirePermission('stock.read')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<InventoryDto> {
    return this.inventories.get(id);
  }

  @RequirePermission('inventory.count')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createInventorySchema)) body: Out<typeof createInventorySchema>,
  ): Promise<InventoryDto> {
    return this.inventories.create(actor, body.warehouseId);
  }

  @RequirePermission('inventory.count')
  @Put(':id/lines')
  putLines(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(inventoryLinesSchema)) body: Out<typeof inventoryLinesSchema>,
  ): Promise<InventoryDto> {
    return this.inventories.putLines(actor, id, body);
  }

  @RequirePermission('inventory.count')
  @Idempotent()
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InventoryResult> {
    return this.inventories.validate(actor, id);
  }

  @RequirePermission('inventory.count')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.inventories.remove(id);
  }
}
