import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module';
import { SyncModule } from '../sync/sync.module';
import { MeController } from './me.controller';
import { VisitService } from './visit.service';
import { WorkdayService } from './workday.service';

/** Journée du vendeur sur le terrain (phase 15) : journée, visites, encaissements, objectifs. */
@Module({
  imports: [SyncModule, PlanningModule],
  controllers: [MeController],
  providers: [WorkdayService, VisitService],
})
export class FieldModule {}
