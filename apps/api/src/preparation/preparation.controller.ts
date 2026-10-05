import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  launchRouteSchema,
  type RouteCandidateDto,
  type RouteSummaryDto,
  routesQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RoutesService } from './routes.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Tournées : lancement de la préparation (UC-61), préparation (UC-41), chargement (UC-42). */
@Controller('routes')
export class PreparationController {
  constructor(private readonly routes: RoutesService) {}

  @RequirePermission('preparation.launch')
  @Get()
  candidates(
    @Query(new ZodValidationPipe(routesQuerySchema)) q: Out<typeof routesQuerySchema>,
  ): Promise<RouteCandidateDto[]> {
    return this.routes.candidates(q.date);
  }

  @RequirePermission('preparation.launch')
  @Post('launch')
  launch(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(launchRouteSchema)) body: Out<typeof launchRouteSchema>,
  ): Promise<RouteCandidateDto> {
    return this.routes.launch(actor, body.date, body.driverId);
  }

  @RequirePermission('preparation.do')
  @Get('preparing')
  toPrepare(): Promise<RouteSummaryDto[]> {
    return this.routes.toPrepare();
  }
}
