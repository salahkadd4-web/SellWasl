import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PlanningModule } from '../planning/planning.module';
import { ObjectivesAdminService } from './objectives-admin.service';
import { PendingLinesService } from './pending-lines.service';
import { QuotasService } from './quotas.service';
import { WorkdaysAdminService } from './workdays-admin.service';
import { SupervisionController } from './supervision.controller';

/** Suivi de la prévente par le superviseur sur le Web (phase 16). */
@Module({
  imports: [FieldModule, PlanningModule],
  controllers: [SupervisionController],
  providers: [QuotasService, ObjectivesAdminService, PendingLinesService, WorkdaysAdminService],
})
export class SupervisionModule {}
