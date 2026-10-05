import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { StockController } from './stock.controller';
import { StockLedger } from './stock-ledger.service';
import { StockQueryService } from './stock-query.service';

/** Entrepôt et stock (phase 17) : registre des mouvements, documents et consultation. */
@Module({
  controllers: [StockController],
  providers: [StockLedger, StockQueryService, ReceiptsService],
  exports: [StockLedger],
})
export class StockModule {}
