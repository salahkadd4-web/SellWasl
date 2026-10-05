import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createLoadSchema, type LoadDto, loadsQuerySchema } from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LoadsService } from './loads.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Chargement des camions (UC-42, phase 17). */
@Controller('loads')
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @RequirePermission('loads.read')
  @Get()
  list(
    @Query(new ZodValidationPipe(loadsQuerySchema)) q: Out<typeof loadsQuerySchema>,
  ): Promise<LoadDto[]> {
    return this.loads.list(q.date);
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
}
