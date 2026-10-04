import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { ObjectivesAdminService } from './objectives-admin.service';
import { QuotasService } from './quotas.service';
import { SupervisionController } from './supervision.controller';

/** Suivi de la prévente par le superviseur sur le Web (phase 16). */
@Module({
  imports: [FieldModule],
  controllers: [SupervisionController],
  providers: [QuotasService, ObjectivesAdminService],
})
export class SupervisionModule {}
