import { Module } from '@nestjs/common';
import { FileStorageService } from '../files/file-storage.service';
import { ImportsController } from '../imports/imports.controller';
import { ImportsService } from '../imports/imports.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { PlacementService } from './placement.service';

/** Clients et import CSV des clients (phase 11). */
@Module({
  controllers: [CustomersController, ImportsController],
  providers: [CustomersService, PlacementService, ImportsService, FileStorageService],
})
export class CustomersModule {}
