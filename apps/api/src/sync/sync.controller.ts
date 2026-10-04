import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { type SyncPushInput, type SyncPushResponse, syncPushSchema } from '@sellwasl/validation';
import { AnyAuthenticated, type AuthUser, CurrentUser } from '../common/auth-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SyncService } from './sync.service';

/** Synchronisation du téléphone (docs/api.md §6). Chaque opération vérifie sa propre permission. */
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @AnyAuthenticated()
  @Post('push')
  @HttpCode(200)
  push(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(syncPushSchema)) body: SyncPushInput,
  ): Promise<SyncPushResponse> {
    return this.sync.push(actor, body);
  }
}
