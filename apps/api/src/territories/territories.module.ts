import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';

/** Secteurs, parties, planning et carte (phase 13). */
@Module({
  imports: [CustomersModule],
  controllers: [TerritoriesController],
  providers: [TerritoriesService],
  exports: [TerritoriesService],
})
export class TerritoriesModule {}
