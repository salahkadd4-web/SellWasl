import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { PlanningModule } from '../planning/planning.module';
import { SyncModule } from '../sync/sync.module';
import { CustomerOpsService } from './customer-ops.service';
import { DebtService } from './debt.service';
import { MeController } from './me.controller';
import { VisitService } from './visit.service';
import { WorkdayService } from './workday.service';

/** Journée du vendeur sur le terrain (phase 15) : journée, visites, encaissements, objectifs. */
@Module({
  imports: [SyncModule, PlanningModule, CustomersModule],
  controllers: [MeController],
  providers: [WorkdayService, VisitService, CustomerOpsService, DebtService],
})
export class FieldModule {}
