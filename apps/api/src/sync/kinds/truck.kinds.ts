import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { OfflineTruckCheck } from '@sellwasl/validation';
import { ApiError } from '../../common/api-error';
import { DriverRouteService } from '../../delivery/driver-route.service';
import { LoadReceiveService } from '../../delivery/load-receive.service';
import { SyncKinds } from '../sync-kinds';

const TRUCK = ['VENDEUR_CASH_VAN', 'LIVREUR'] as const;

/** Sans camion attribué, la sorte est vide (le téléphone affiche « pas de camion »). */
async function orEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ApiError) return [];
    throw error;
  }
}

/** Sortes du camion et de la tournée : stock, pointage, tournée du livreur. */
@Injectable()
export class TruckKinds implements OnModuleInit {
  constructor(
    private readonly kinds: SyncKinds,
    private readonly driverRoute: DriverRouteService,
    private readonly loads: LoadReceiveService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      kind: 'driverDay',
      roles: ['LIVREUR'],
      mode: 'set',
      sources: [
        'deliveryRoute',
        'delivery',
        'order',
        'orderLine',
        'load',
        'loadLine',
        'customer',
        'workday',
        'payment',
      ],
      load: async ({ actor }) => {
        const day = await this.driverRoute.route(actor);
        return [{ id: day.date, data: day }];
      },
    });

    this.kinds.register({
      kind: 'truckStock',
      roles: TRUCK,
      mode: 'set',
      sources: ['stock', 'warehouse', 'productUnit', 'productVariant'],
      load: ({ actor }) =>
        orEmpty(async () =>
          (await this.driverRoute.truckStock(actor)).map((s) => ({ id: s.variantId, data: s })),
        ),
    });

    this.kinds.register({
      kind: 'truckCheck',
      roles: TRUCK,
      mode: 'set',
      sources: ['stock', 'warehouse', 'load', 'loadLine'],
      load: async ({ actor }) => {
        const data: OfflineTruckCheck = {
          lines: await orEmpty(() => this.loads.checkLines(actor)),
        };
        return [{ id: 'current', data }];
      },
    });
  }
}
