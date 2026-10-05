import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { PreparationController } from './preparation.controller';
import { RoutesService } from './routes.service';

/** Préparation des tournées (phase 18). */
@Module({
  imports: [StockModule],
  controllers: [PreparationController],
  providers: [RoutesService],
})
export class PreparationModule {}
