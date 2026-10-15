import { Module } from '@nestjs/common';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { OpeningDebtImportService } from '../imports/opening-debt-import.service';
import { ProductImportService } from '../imports/product-import.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { OpeningDebtService } from './opening-debt.service';
import { OpeningDebtsController } from './opening-debts.controller';
import { PlacementService } from './placement.service';

/**
 * Clients (phase 11), imports CSV des clients et des produits (phases 11 et 12), soldes d'ouverture
 * des dettes (BR-PAY-09).
 */
@Module({
  controllers: [CustomersController, ImportsController, OpeningDebtsController],
  providers: [
    CustomersService,
    PlacementService,
    ImportsService,
    ProductImportService,
    OpeningDebtService,
    OpeningDebtImportService,
  ],
  exports: [PlacementService, CustomersService],
})
export class CustomersModule {}
