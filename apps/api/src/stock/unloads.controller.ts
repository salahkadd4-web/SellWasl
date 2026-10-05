import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  createUnloadSchema,
  type PendingUnloadDto,
  type UnloadDto,
  type UnloadPreviewLine,
  unloadPreviewQuerySchema,
  unloadsQuerySchema,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { type AuthUser, CurrentUser, RequirePermission } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UnloadsService } from './unloads.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Déchargement des camions (UC-43, phase 17). */
@Controller('unloads')
export class UnloadsController {
  constructor(private readonly unloads: UnloadsService) {}

  @RequirePermission('loads.read')
  @Get()
  list(
    @Query(new ZodValidationPipe(unloadsQuerySchema)) q: Out<typeof unloadsQuerySchema>,
  ): Promise<UnloadDto[]> {
    return this.unloads.list(q.date);
  }

  @RequirePermission('loads.read')
  @Get('pending')
  pending(): Promise<PendingUnloadDto[]> {
    return this.unloads.pending();
  }

  @RequirePermission('loads.read')
  @Get('preview')
  preview(
    @Query(new ZodValidationPipe(unloadPreviewQuerySchema)) q: Out<typeof unloadPreviewQuerySchema>,
  ): Promise<UnloadPreviewLine[]> {
    return this.unloads.preview(q.workdayId);
  }

  @RequirePermission('unloads.validate')
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createUnloadSchema)) body: Out<typeof createUnloadSchema>,
  ): Promise<UnloadDto> {
    return this.unloads.validate(actor, body);
  }
}
