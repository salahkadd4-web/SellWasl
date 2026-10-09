import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  createLoadSchema,
  lastLoadQuerySchema,
  type LoadDto,
  loadsQuerySchema,
  planLoadSchema,
  validateLoadSchema,
  type Page,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { Idempotent } from '../common/idempotency';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LoadsService } from './loads.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Chargement des camions (UC-42, phase 17) ; chargement cash van préparé (UC-62, phase 20). */
@Controller('loads')
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @RequirePermission('loads.read')
  @Get()
  list(
    @Query(new ZodValidationPipe(loadsQuerySchema)) q: Out<typeof loadsQuerySchema>,
  ): Promise<Page<LoadDto>> {
    return this.loads.list(q);
  }

  @RequirePermission('loads.read')
  @Get('planned')
  planned(): Promise<LoadDto[]> {
    return this.loads.planned();
  }

  /** Dernier chargement d'un camion, pour en préparer un nouveau à partir de lui. */
  @RequirePermission('loads.read')
  @Get('last')
  last(
    @Query(new ZodValidationPipe(lastLoadQuerySchema)) q: Out<typeof lastLoadQuerySchema>,
  ): Promise<LoadDto | null> {
    return this.loads.last(q.truckId);
  }

  @RequirePermission('loads.read')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<LoadDto> {
    return this.loads.get(id);
  }

  @RequirePermission('loads.load')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createLoadSchema)) body: Out<typeof createLoadSchema>,
  ): Promise<LoadDto> {
    return this.loads.create(actor, body);
  }

  @RequirePermission('loads.plan')
  @Idempotent()
  @Post('plan')
  plan(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(planLoadSchema)) body: Out<typeof planLoadSchema>,
  ): Promise<LoadDto> {
    return this.loads.plan(actor, body);
  }

  @RequirePermission('loads.load')
  @Idempotent()
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(validateLoadSchema)) body: Out<typeof validateLoadSchema>,
  ): Promise<LoadDto> {
    return this.loads.validate(actor, id, body);
  }
}
