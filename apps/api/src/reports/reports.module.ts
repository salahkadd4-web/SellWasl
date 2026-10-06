import { Module } from '@nestjs/common';
import { PlanningModule } from '../planning/planning.module';
import { ReturnsModule } from '../returns/returns.module';
import { StockModule } from '../stock/stock.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { LiveService } from './live.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Dashboard, suivi du jour, rapports et exports (phase 21). */
@Module({
  imports: [PlanningModule, StockModule, ReturnsModule],
  controllers: [ReportsController, ExportsController],
  providers: [ReportsService, LiveService, ExportsService],
})
export class ReportsModule {}
