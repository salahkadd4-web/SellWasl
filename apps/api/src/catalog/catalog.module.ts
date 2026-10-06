import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/** Catalogue, prix, paliers et bonus (phase 12). */
@Module({
  controllers: [CatalogController, SuppliersController],
  providers: [CatalogService, PricingService, SuppliersService],
  exports: [CatalogService, PricingService, SuppliersService],
})
export class CatalogModule {}
