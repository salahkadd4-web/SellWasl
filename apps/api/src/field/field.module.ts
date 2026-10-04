import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { PlanningModule } from '../planning/planning.module';
import { SyncModule } from '../sync/sync.module';
import { CustomerOpsService } from './customer-ops.service';
import { DebtService } from './debt.service';
import { MeController } from './me.controller';
import { ObjectivesService } from './objectives.service';
import { OrderService } from './order.service';
import { VisitCatalogService } from './visit-catalog.service';
import { VisitService } from './visit.service';
import { WorkdayService } from './workday.service';

/** Journée du vendeur sur le terrain (phase 15) : journée, visites, encaissements, objectifs. */
@Module({
  imports: [SyncModule, PlanningModule, CustomersModule, CatalogModule],
  controllers: [MeController],
  providers: [
    WorkdayService,
    VisitService,
    CustomerOpsService,
    DebtService,
    ObjectivesService,
    OrderService,
    VisitCatalogService,
  ],
})
export class FieldModule {}
