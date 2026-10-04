import { Controller, Get, Query } from '@nestjs/common';
import { myTodayQuerySchema, type TodayResponse } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkdayService } from './workday.service';

/** Lectures du vendeur connecté sur son téléphone (phase 15). */
@Controller('me')
export class MeController {
  constructor(private readonly workdays: WorkdayService) {}

  @RequirePermission('workdays.own')
  @Get('today')
  today(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(myTodayQuerySchema)) query: z.output<typeof myTodayQuerySchema>,
  ): Promise<TodayResponse> {
    return this.workdays.today(actor, query.date);
  }
}
