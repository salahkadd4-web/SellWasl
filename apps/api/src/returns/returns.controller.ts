import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  myRefusalsQuerySchema,
  RETURN_AXES,
  type RefusalDto,
  refusalDecisionSchema,
  type ReturnAxis,
  type ReturnFactDto,
  returnFactsQuerySchema,
  type ReturnsAxisDto,
  type ReturnsCrossDto,
  returnsCrossQuerySchema,
  returnsQuerySchema,
} from '@sellwasl/validation';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RefusalsService } from './refusals.service';
import { ReturnsService } from './returns.service';

type Out<T extends z.ZodType> = z.output<T>;
const axisParam = new ZodValidationPipe(z.enum(RETURN_AXES));

/** Analyse des retours et contestation des refus (module RETURNS_ANALYSIS, phase 21). */
@Controller()
export class ReturnsController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly refusals: RefusalsService,
  ) {}

  @RequirePermission('returns.read')
  @Get('returns/axis/:axis')
  axis(
    @Param('axis', axisParam) axis: ReturnAxis,
    @Query(new ZodValidationPipe(returnsQuerySchema)) q: Out<typeof returnsQuerySchema>,
  ): Promise<ReturnsAxisDto> {
    return this.returns.axis(axis, q);
  }

  @RequirePermission('returns.read')
  @Get('returns/cross')
  cross(
    @Query(new ZodValidationPipe(returnsCrossQuerySchema)) q: Out<typeof returnsCrossQuerySchema>,
  ): Promise<ReturnsCrossDto> {
    return this.returns.cross(q);
  }

  @RequirePermission('returns.read')
  @Get('returns/facts')
  facts(
    @Query(new ZodValidationPipe(returnFactsQuerySchema)) q: Out<typeof returnFactsQuerySchema>,
  ): Promise<ReturnFactDto[]> {
    return this.returns.list(q);
  }

  @RequirePermission('returns.contest')
  @Get('me/refusals')
  mine(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(myRefusalsQuerySchema)) q: Out<typeof myRefusalsQuerySchema>,
  ): Promise<RefusalDto[]> {
    return this.refusals.mine(actor, q.from, q.to);
  }

  @RequirePermission('returns.decide')
  @Get('refusals/contested')
  contested(): Promise<RefusalDto[]> {
    return this.refusals.contested();
  }

  @RequirePermission('returns.decide')
  @Post('refusals/:deliveryId/decide')
  @HttpCode(200)
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string,
    @Body(new ZodValidationPipe(refusalDecisionSchema)) body: Out<typeof refusalDecisionSchema>,
  ): Promise<RefusalDto> {
    return this.refusals.decide(actor, deliveryId, body.upheld);
  }
}
