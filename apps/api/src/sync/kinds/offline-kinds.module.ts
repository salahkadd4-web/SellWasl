import { Module } from '@nestjs/common';
import { CatalogModule } from '../../catalog/catalog.module';
import { DeliveryModule } from '../../delivery/delivery.module';
import { FieldModule } from '../../field/field.module';
import { PlanningModule } from '../../planning/planning.module';
import { TerritoriesModule } from '../../territories/territories.module';
import { SyncModule } from '../sync.module';
import { FieldKinds } from './field.kinds';
import { ReferenceKinds } from './reference.kinds';
import { TruckKinds } from './truck.kinds';

/** Sortes de données envoyées au téléphone hors connexion (GET /sync/pull, phase 23). */
@Module({
  imports: [
    SyncModule,
    CatalogModule,
    DeliveryModule,
    FieldModule,
    PlanningModule,
    TerritoriesModule,
  ],
  providers: [ReferenceKinds, FieldKinds, TruckKinds],
})
export class OfflineKindsModule {}
