import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncKinds } from './sync-kinds';
import { SyncLogService } from './sync-log.service';
import { SyncPullService } from './sync-pull.service';
import { SyncHandlers } from './sync.handlers';
import { SyncService } from './sync.service';

/**
 * Synchronisation du téléphone : réception des opérations (les modules métier inscrivent leurs
 * traitements) et envoi des données hors connexion (sortes inscrites par OfflineKindsModule).
 */
@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncHandlers, SyncKinds, SyncPullService, SyncLogService],
  exports: [SyncHandlers, SyncKinds],
})
export class SyncModule {}
