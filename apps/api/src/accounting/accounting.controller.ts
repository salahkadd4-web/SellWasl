import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createSettlementSchema,
  type DaySummaryDto,
  type DebtorDto,
  type PaymentRowDto,
  paymentsQuerySchema,
  type SettlementRowDto,
  settlementsQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Idempotent } from '../common/idempotency';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountingService } from './accounting.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Comptabilité sur le Web (phase 20, UC-70, UC-71). */
@Controller()
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @RequirePermission('workdays.read')
  @Get('workdays/:id/summary')
  summary(@Param('id', new ParseUUIDPipe()) id: string): Promise<DaySummaryDto> {
    return this.accounting.workdaySummary(id);
  }

  @RequirePermission('settlements.read')
  @Get('settlements')
  settlements(
    @Query(new ZodValidationPipe(settlementsQuerySchema)) q: Out<typeof settlementsQuerySchema>,
  ): Promise<SettlementRowDto[]> {
    return this.accounting.settlements(q.date);
  }

  @RequirePermission('settlements.create')
  @Idempotent()
  @Post('settlements')
  settle(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createSettlementSchema)) body: Out<typeof createSettlementSchema>,
  ): Promise<SettlementRowDto> {
    return this.accounting.settle(actor, body.workdayId, body.remittedAmount, body.note);
  }

  @RequirePermission('payments.read')
  @Get('debtors')
  debtors(): Promise<DebtorDto[]> {
    return this.accounting.debtors();
  }

  @RequirePermission('payments.read')
  @Get('payments')
  payments(
    @Query(new ZodValidationPipe(paymentsQuerySchema)) q: Out<typeof paymentsQuerySchema>,
  ): Promise<PaymentRowDto[]> {
    return this.accounting.payments(q.from, q.to);
  }

  @RequirePermission('payments.read')
  @Get('payments/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="paiements.csv"')
  paymentsCsv(
    @Query(new ZodValidationPipe(paymentsQuerySchema)) q: Out<typeof paymentsQuerySchema>,
  ): Promise<string> {
    return this.accounting.paymentsCsv(q.from, q.to);
  }
}
