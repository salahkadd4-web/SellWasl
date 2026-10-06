import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PlanningModule } from '../planning/planning.module';
import { StockModule } from '../stock/stock.module';
import { DriverObjectivesService } from './driver-objectives.service';
import { ObjectivesAdminService } from './objectives-admin.service';
import { PendingLinesService } from './pending-lines.service';
import { QuotasService } from './quotas.service';
import { WorkdaysAdminService } from './workdays-admin.service';
import { SupervisionController } from './supervision.controller';

/** Suivi de la prévente par le superviseur sur le Web (phase 16). */
@Module({
  imports: [FieldModule, PlanningModule, StockModule],
  controllers: [SupervisionController],
  providers: [
    QuotasService,
    ObjectivesAdminService,
    PendingLinesService,
    WorkdaysAdminService,
    DriverObjectivesService,
  ],
  exports: [DriverObjectivesService],
})
export class SupervisionModule {}
