import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  planningCalendarQuerySchema,
  type PlanningCalendarDay,
  type PlanningDay,
  planningDayQuerySchema,
  type RescheduleDto,
  rescheduleSchema,
  reschedulesQuerySchema,
} from '@sellwasl/validation';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PlanningService } from './planning.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = new ParseUUIDPipe();
const dateParam = new ZodValidationPipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ'));

/** Clients du jour et reprogrammations (docs/api.md §5.3, UC-54). */
@Controller()
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @RequirePermission('territories.read')
  @Get('planning/day')
  day(
    @Query(new ZodValidationPipe(planningDayQuerySchema)) query: Out<typeof planningDayQuerySchema>,
  ): Promise<PlanningDay> {
    return this.planning.day(query.userId, query.date);
  }

  @RequirePermission('territories.read')
  @Get('planning/calendar')
  calendar(
    @Query(new ZodValidationPipe(planningCalendarQuerySchema))
    query: Out<typeof planningCalendarQuerySchema>,
  ): Promise<PlanningCalendarDay[]> {
    return this.planning.calendar(query.userId, query.from, query.days);
  }

  @RequirePermission('territories.read')
  @Get('planning/reschedules')
  reschedules(
    @Query(new ZodValidationPipe(reschedulesQuerySchema)) query: Out<typeof reschedulesQuerySchema>,
  ): Promise<RescheduleDto[]> {
    return this.planning.reschedules({ userId: query.userId });
  }

  @RequirePermission('customers.read')
  @Get('customers/:id/reschedules')
  customerReschedules(@Param('id', uuid) id: string): Promise<RescheduleDto[]> {
    return this.planning.reschedules({ customerId: id });
  }

  @RequirePermission('customers.reschedule')
  @Post('customers/:id/reschedules')
  @HttpCode(201)
  reschedule(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(rescheduleSchema)) body: Out<typeof rescheduleSchema>,
  ): Promise<RescheduleDto> {
    return this.planning.reschedule(user, id, body.date);
  }

  @RequirePermission('customers.reschedule')
  @Delete('customers/:id/reschedules/:date')
  @HttpCode(204)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('date', dateParam) date: string,
  ): Promise<void> {
    return this.planning.cancelReschedule(user, id, date);
  }
}
