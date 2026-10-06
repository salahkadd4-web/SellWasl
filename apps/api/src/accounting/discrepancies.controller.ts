import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type DiscrepancyDto,
  discrepanciesQuerySchema,
  discrepancyDecisionSchema,
  type SettlementDetailDto,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AccountingService } from './accounting.service';
import { DiscrepanciesService } from './discrepancies.service';

const uuid = new ParseUUIDPipe();

/** Écarts de stock et de caisse, détail d'un versement (phase 21 bis). */
@Controller()
export class DiscrepanciesController {
  constructor(
    private readonly discrepancies: DiscrepanciesService,
    private readonly accounting: AccountingService,
  ) {}

  @RequirePermission('discrepancies.read')
  @Get('discrepancies')
  list(
    @Query(new ZodValidationPipe(discrepanciesQuerySchema))
    q: z.output<typeof discrepanciesQuerySchema>,
  ): Promise<DiscrepancyDto[]> {
    return this.discrepancies.list(q);
  }

  @RequirePermission('discrepancies.decide')
  @Post('discrepancies/:id/review')
  @HttpCode(200)
  review(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string): Promise<DiscrepancyDto> {
    return this.discrepancies.review(actor, id);
  }

  @RequirePermission('discrepancies.decide')
  @Post('discrepancies/:id/decide')
  @HttpCode(200)
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(discrepancyDecisionSchema))
    body: z.output<typeof discrepancyDecisionSchema>,
  ): Promise<DiscrepancyDto> {
    return this.discrepancies.decide(actor, id, body);
  }

  @RequirePermission('settlements.read')
  @Get('settlements/:workdayId/detail')
  detail(@Param('workdayId', uuid) workdayId: string): Promise<SettlementDetailDto> {
    return this.accounting.detail(workdayId);
  }
}
