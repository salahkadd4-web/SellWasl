import { Injectable, type OnModuleInit } from '@nestjs/common';
import { customerCreatePayload } from '@sellwasl/validation';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
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
        // Nouveau client à valider par le superviseur (BR-CLI-05, BR-NOT-02)
        await this.notifications.notify(ctx.tx, {
          companyId: ctx.actor.companyId,
          type: 'NEW_CUSTOMER',
          title: 'Nouveau client',
          body: `${fields.name}, créé par ${await this.notifications.userLabel(ctx.tx, ctx.actor.userId)}${created.part ? '' : ' (hors partie)'}.`,
          data: { href: '/app/clients' },
          to: { permission: 'customers.update' },
          actorUserId: ctx.actor.userId,
        });
        return {
          customerId,
          partName: created.part?.name ?? null,
          outOfPart: created.part === null,
        };
      },
    );
  }
}
