import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { ReceiptsService } from './receipts.service';
import { StockController } from './stock.controller';
import { StockLedger } from './stock-ledger.service';
import { StockQueryService } from './stock-query.service';

/** Entrepôt et stock (phase 17) : registre des mouvements, documents et consultation. */
@Module({
  controllers: [StockController, InventoryController],
  providers: [StockLedger, StockQueryService, ReceiptsService, InventoryService],
  exports: [StockLedger],
})
export class StockModule {}
