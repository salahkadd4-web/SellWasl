import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';

/** Catalogue, prix, paliers et bonus (phase 12). */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PricingService],
  exports: [CatalogService, PricingService],
})
export class CatalogModule {}
