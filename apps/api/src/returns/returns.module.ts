import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { RefusalsService } from './refusals.service';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/** Analyse des retours et contestation des refus (phase 21). */
@Module({
  imports: [SyncModule],
  controllers: [ReturnsController],
  providers: [ReturnsService, RefusalsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
