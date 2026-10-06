import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  type LotDto,
  lotsQuerySchema,
  type SupplierDto,
  supplierSchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SuppliersService } from './suppliers.service';

const partialSupplier = supplierSchema.partial();

/** Fournisseurs et lots (phase 21). */
@Controller()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequirePermission('products.read')
  @Get('suppliers')
  list(): Promise<SupplierDto[]> {
    return this.suppliers.list();
  }

  @RequirePermission('products.write')
  @Post('suppliers')
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(supplierSchema)) body: z.output<typeof supplierSchema>,
  ): Promise<SupplierDto> {
    return this.suppliers.create(actor, body);
  }

  @RequirePermission('products.write')
  @Patch('suppliers/:id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(partialSupplier)) body: z.output<typeof partialSupplier>,
  ): Promise<SupplierDto> {
    return this.suppliers.update(actor, id, body);
  }

  @RequirePermission('stock.read')
  @Get('lots')
  lots(
    @Query(new ZodValidationPipe(lotsQuerySchema)) q: z.output<typeof lotsQuerySchema>,
  ): Promise<LotDto[]> {
    return this.suppliers.lots(q.variantId);
  }
}
