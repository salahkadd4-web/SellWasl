import { Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { Idempotent } from '../common/idempotency';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ImageStorageService,
  MAX_IMAGE_BYTES,
  type UploadedImage,
} from '../files/image-storage.service';
import { UnloadsService } from './unloads.service';

type Out<T extends z.ZodType> = z.output<T>;

/** Déchargement des camions (UC-43, phase 17). */
@Controller('unloads')
export class UnloadsController {
  constructor(
    private readonly unloads: UnloadsService,
    private readonly images: ImageStorageService,
  ) {}

  /** Photo d'un produit défectueux, avant la validation du déchargement (phase 21). */
  @RequirePermission('unloads.validate')
  @Post('photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async photo(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<{ key: string; url: string | null }> {
    const key = await this.images.save(actor.companyId, 'returns', file);
    return { key, url: this.images.urls(key)?.url ?? null };
  }

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
  @Idempotent()
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createUnloadSchema)) body: Out<typeof createUnloadSchema>,
  ): Promise<UnloadDto> {
    return this.unloads.validate(actor, body);
  }
}
