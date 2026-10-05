import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { StockModule } from '../stock/stock.module';
import { PreparationController } from './preparation.controller';
import { PreparationService } from './preparation.service';
import { RouteLoadService } from './route-load.service';
import { RoutesService } from './routes.service';

/** Préparation des tournées (phase 18). */
@Module({
  imports: [StockModule, CatalogModule],
  controllers: [PreparationController],
  providers: [RoutesService, PreparationService, RouteLoadService],
})
export class PreparationModule {}
