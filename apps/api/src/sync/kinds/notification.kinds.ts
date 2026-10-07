import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { notificationReadPayload } from '@sellwasl/validation';
import { NotificationsService, toNotificationDto } from '../../notifications/notifications.service';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { SyncHandlers } from '../sync.handlers';
import { SyncKinds } from '../sync-kinds';

/** Notifications gardées sur le téléphone (30 jours). */
const KEEP_DAYS = 30;

/**
 * Notifications du terrain hors connexion (phase 24) : reçues par la synchronisation, marquées lues
 * par l'opération `notification.read` mise en file.
 */
@Injectable()
export class NotificationKinds implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly kinds: SyncKinds,
    private readonly handlers: SyncHandlers,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      kind: 'notification',
      roles: ['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'],
      mode: 'rows',
      sources: ['notification'],
      load: async ({ actor, cursor, full }) => {
        // Heure du serveur : la date du téléphone peut être fausse
        const since = new Date(Date.now() - KEEP_DAYS * 24 * 3600_000);
        const rows = await this.db.notification.findMany({
          where: {
            userId: actor.userId,
            ...(full
              ? { deletedAt: null, createdAt: { gte: since } }
              : { changeXid: { gte: cursor } }),
          },
        });
        return rows.map((n) =>
          n.deletedAt
            ? { id: n.id, data: null, deleted: true }
            : { id: n.id, data: toNotificationDto(n) },
        );
      },
    });

    this.handlers.register(
      'notification.read',
      'workdays.own',
      notificationReadPayload,
      async (ctx) => ({
        read: await this.notifications.markRead(
          ctx.tx,
          ctx.actor.userId,
          ctx.payload.notificationIds,
        ),
      }),
    );
  }
}
