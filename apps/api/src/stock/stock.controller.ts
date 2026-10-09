import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  createReceiptSchema,
  movementsQuerySchema,
  putThresholdsSchema,
  type ReceiptDto,
  type StockAlertDto,
  type StockMovementDto,
  type StockRowDto,
  stockQuerySchema,
  type Page,
  stockReceiptsQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Idempotent } from '../common/idempotency';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReceiptsService } from './receipts.service';
import { StockQueryService } from './stock-query.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Stock : consultation, entrées au dépôt, seuils (phase 17, docs/api.md). */
@Controller('stock')
export class StockController {
  constructor(
    private readonly query: StockQueryService,
    private readonly receipts: ReceiptsService,
  ) {}

  @RequirePermission('stock.read')
  @Get()
  levels(
    @Query(new ZodValidationPipe(stockQuerySchema)) q: Out<typeof stockQuerySchema>,
  ): Promise<StockRowDto[]> {
    return this.query.levels(q.warehouseId);
  }

  @RequirePermission('stock.read')
  @Get('movements')
  movements(
    @Query(new ZodValidationPipe(movementsQuerySchema)) q: Out<typeof movementsQuerySchema>,
  ): Promise<Page<StockMovementDto>> {
    return this.query.movements(q);
  }

  @RequirePermission('stock.read')
  @Get('alerts')
  alerts(): Promise<StockAlertDto[]> {
    return this.query.alerts();
  }

  @RequirePermission('products.write')
  @Put('thresholds')
  thresholds(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(putThresholdsSchema)) body: Out<typeof putThresholdsSchema>,
  ): Promise<{ updated: number }> {
    return this.query.setThresholds(actor, body);
  }

  @RequirePermission('stock.read')
  @Get('receipts')
  listReceipts(
    @Query(new ZodValidationPipe(stockReceiptsQuerySchema))
    q: Out<typeof stockReceiptsQuerySchema>,
  ): Promise<Page<ReceiptDto>> {
    return this.receipts.list(q);
  }

  @RequirePermission('stock.read')
  @Get('receipts/:id')
  receipt(@Param('id', new ParseUUIDPipe()) id: string): Promise<ReceiptDto> {
    return this.receipts.get(id);
  }

  @RequirePermission('stock.receive')
  @Idempotent()
  @Post('receipts')
  createReceipt(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createReceiptSchema)) body: Out<typeof createReceiptSchema>,
  ): Promise<ReceiptDto> {
    return this.receipts.create(actor, body);
  }
}
