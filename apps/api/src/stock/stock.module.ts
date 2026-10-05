import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LoadsController } from './loads.controller';
import { LoadsService } from './loads.service';
import { ReceiptsService } from './receipts.service';
import { StockController } from './stock.controller';
import { StockLedger } from './stock-ledger.service';
import { StockQueryService } from './stock-query.service';
import { UnloadsController } from './unloads.controller';
import { UnloadsService } from './unloads.service';

/** Entrepôt et stock (phase 17) : registre des mouvements, documents et consultation. */
@Module({
  controllers: [StockController, InventoryController, LoadsController, UnloadsController],
  providers: [
    StockLedger,
    StockQueryService,
    ReceiptsService,
    InventoryService,
    LoadsService,
    UnloadsService,
  ],
  exports: [StockLedger],
})
export class StockModule {}
