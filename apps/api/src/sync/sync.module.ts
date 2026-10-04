import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncHandlers } from './sync.handlers';
import { SyncService } from './sync.service';

/** Réception des opérations du téléphone ; les modules métier inscrivent leurs traitements. */
@Module({
  controllers: [SyncController],
  providers: [SyncService, SyncHandlers],
  exports: [SyncHandlers],
})
export class SyncModule {}
