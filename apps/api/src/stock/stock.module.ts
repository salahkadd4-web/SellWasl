import { Module } from '@nestjs/common';
import { StockLedger } from './stock-ledger.service';

/** Entrepôt et stock (phase 17) : registre des mouvements, documents et consultation. */
@Module({
  providers: [StockLedger],
  exports: [StockLedger],
})
export class StockModule {}
