import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/** Comptabilité (phase 20) : récapitulatifs, versements, dettes, paiements. */
@Module({
  imports: [DeliveryModule],
  controllers: [AccountingController],
  providers: [AccountingService],
})
export class AccountingModule {}
