import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { DiscrepanciesController } from './discrepancies.controller';
import { DiscrepanciesService } from './discrepancies.service';

/** Comptabilité (phase 20) : récapitulatifs, versements, dettes, paiements. */
@Module({
  imports: [DeliveryModule],
  controllers: [AccountingController, DiscrepanciesController],
  providers: [AccountingService, DiscrepanciesService],
  exports: [DiscrepanciesService],
})
export class AccountingModule {}
