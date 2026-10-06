import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  type Page,
  type SyncOperationRowDto,
  type SyncOperationsQuery,
  syncOperationsQuerySchema,
  type SyncPullQuery,
  syncPullQuerySchema,
  type SyncPullResponse,
  type SyncPushInput,
  type SyncPushResponse,
  syncPushSchema,
} from '@sellwasl/validation';
import {
  AnyAuthenticated,
  type AuthUser,
  CurrentUser,
  RequirePermission,
} from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SyncLogService } from './sync-log.service';
import { SyncPullService } from './sync-pull.service';
import { SyncService } from './sync.service';

/** Synchronisation du téléphone (docs/api.md §6). Chaque opération vérifie sa propre permission. */
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly pulls: SyncPullService,
    private readonly log: SyncLogService,
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

  /** Journal de synchronisation (BR-SYN-07) : diagnostic du superviseur. */
  @RequirePermission('devices.read')
  @Get('operations')
  operations(
    @Query(new ZodValidationPipe(syncOperationsQuerySchema)) query: SyncOperationsQuery,
  ): Promise<Page<SyncOperationRowDto>> {
    return this.log.list(query);
  }
}
