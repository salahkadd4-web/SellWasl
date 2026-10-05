import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { PreparationModule } from '../preparation/preparation.module';
import { StockModule } from '../stock/stock.module';
import { SyncModule } from '../sync/sync.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DriverRouteService } from './driver-route.service';
import { LoadReceiveService } from './load-receive.service';

/** Livraison (phase 19) : réception du chargement, livraisons, échecs, lectures du livreur. */
@Module({
  imports: [FieldModule, StockModule, SyncModule, PreparationModule],
  controllers: [DeliveryController],
  providers: [DriverRouteService, LoadReceiveService, DeliveryService],
})
export class DeliveryModule {}
