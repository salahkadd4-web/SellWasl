import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  launchRouteSchema,
  type PrepareResult,
  prepareRouteSchema,
  type LoadDto,
  type RouteCandidateDto,
  type RoutePreparationDto,
  type RouteSummaryDto,
  routesQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PreparationService } from './preparation.service';
import { RouteLoadService } from './route-load.service';
import { RoutesService } from './routes.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Tournées : lancement de la préparation (UC-61), préparation (UC-41), chargement (UC-42). */
@Controller('routes')
export class PreparationController {
  constructor(
    private readonly routes: RoutesService,
    private readonly preparation: PreparationService,
    private readonly routeLoads: RouteLoadService,
  ) {}

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

  @RequirePermission('preparation.do')
  @Get(':id/preparation')
  view(@Param('id', new ParseUUIDPipe()) id: string): Promise<RoutePreparationDto> {
    return this.preparation.view(id);
  }

  @RequirePermission('preparation.do')
  @Post(':id/prepare')
  @HttpCode(200)
  prepare(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(prepareRouteSchema)) body: Out<typeof prepareRouteSchema>,
  ): Promise<PrepareResult> {
    return this.preparation.prepare(actor, id, body);
  }

  @RequirePermission('loads.load')
  @Post(':id/load')
  load(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LoadDto> {
    return this.routeLoads.load(actor, id);
  }
}
