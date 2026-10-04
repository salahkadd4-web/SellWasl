import { Injectable, type OnModuleInit } from '@nestjs/common';
import { customerCreatePayload } from '@sellwasl/validation';
import { CustomersService } from '../customers/customers.service';
import { SyncHandlers } from '../sync/sync.handlers';

/**
 * Client créé par le vendeur sur son téléphone (UC-12) : mêmes règles que la création en ligne
 * (BR-CLI-02, BR-CLI-03), avec l'identifiant choisi par le téléphone.
 */
@Injectable()
export class CustomerOpsService implements OnModuleInit {
  constructor(
    private readonly customers: CustomersService,
    private readonly handlers: SyncHandlers,
  ) {}

  onModuleInit(): void {
    this.handlers.register(
      'customer.create',
      'customers.create',
      customerCreatePayload,
      async (ctx) => {
        const { customerId, ...fields } = ctx.payload;
        const created = await this.customers.create(
          ctx.actor,
          {
            ...fields,
            code: null,
            phone: fields.phone ?? null,
            address: fields.address ?? null,
            referenceDate: null,
            isCreditAllowed: false,
            creditLimitAmount: 0,
          },
          { id: customerId, tx: ctx.tx },
        );
        return {
          customerId,
          partName: created.part?.name ?? null,
          outOfPart: created.part === null,
        };
      },
    );
  }
}
