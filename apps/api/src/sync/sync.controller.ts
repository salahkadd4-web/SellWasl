import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  type SyncPullQuery,
  syncPullQuerySchema,
  type SyncPullResponse,
  type SyncPushInput,
  type SyncPushResponse,
  syncPushSchema,
} from '@sellwasl/validation';
import { AnyAuthenticated, type AuthUser, CurrentUser } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SyncPullService } from './sync-pull.service';
import { SyncService } from './sync.service';

/** Synchronisation du téléphone (docs/api.md §6). Chaque opération vérifie sa propre permission. */
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly pulls: SyncPullService,
  ) {}

  @AnyAuthenticated()
  @Post('push')
  @HttpCode(200)
  push(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(syncPushSchema)) body: SyncPushInput,
  ): Promise<SyncPushResponse> {
    return this.sync.push(actor, body);
  }

  /** Données hors connexion du téléphone, par sortes et par pages (phase 23). */
  @AnyAuthenticated()
  @Get('pull')
  pull(
    @CurrentUser() actor: AuthUser,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) query: SyncPullQuery,
  ): Promise<SyncPullResponse> {
    return this.pulls.pull(actor, query);
  }
}
