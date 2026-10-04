import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

/** Planification des visites (phase 14). */
@Module({ controllers: [PlanningController], providers: [PlanningService] })
export class PlanningModule {}
