import { Module } from '@nestjs/common';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { ProductImportService } from '../imports/product-import.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { PlacementService } from './placement.service';

/** Clients (phase 11) et imports CSV des clients et des produits (phases 11 et 12). */
@Module({
  controllers: [CustomersController, ImportsController],
  providers: [CustomersService, PlacementService, ImportsService, ProductImportService],
})
export class CustomersModule {}
