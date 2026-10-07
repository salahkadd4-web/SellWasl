import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isPermissionModuleActive } from '@sellwasl/business-rules';
import type {
  NotificationDto,
  NotificationListQuery,
  NotificationType,
  Page,
} from '@sellwasl/validation';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import type { Notification, Prisma } from '../generated/prisma/client';
import { ModulesService } from '../modules/modules.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

export interface NotifyInput {
  companyId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** `href` : page du Web ; `deviceId` : appareil révoqué (DEVICE_REVOKED). */
  data?: Record<string, unknown> & { href?: string; deviceId?: string };
  /** Utilisateurs précis, ou tous ceux dont le rôle a le droit (module actif). */
  to: { userIds?: string[]; permission?: string };
  /** Auteur de l'action : jamais notifié. */
  actorUserId?: string | null;
}

export function toNotificationDto(n: Notification): NotificationDto {
  const data = (n.data ?? {}) as { href?: unknown };
  return {
    id: n.id,
    type: n.type as NotificationType,
    title: n.title,
    body: n.body,
    href: typeof data.href === 'string' ? data.href : null,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
  };
}

/** Curseur opaque : date et id de la dernière notification de la page. */
function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([n.createdAt.toISOString(), n.id])).toString('base64url');
}
function decodeCursor(cursor: string): Prisma.NotificationWhereInput {
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as [string, string];
    const createdAt = new Date(at);
    return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Curseur invalide.');
  }
}

/**
 * Notifications internes (BR-NOT-01) : enregistrées dans la transaction de l'action, lues par le
 * Web (cloche) et le téléphone (synchronisation), poussées sur le téléphone par PushDispatcher.
 */
@Injectable()
export class NotificationsService {
  private readonly listeners = new Set<() => void>();

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly modules: ModulesService,
  ) {}

  /** Prévenu après chaque notification enregistrée (envoi push au plus tôt). */
  onNotify(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Après la validation de la transaction : déclenche l'envoi push sans l'attendre. */
  kick(): void {
    for (const listener of this.listeners) listener();
  }

  /** « Prénom Nom (CODE) » d'un utilisateur, pour le texte des notifications. */
  async userLabel(tx: Pick<Prisma.TransactionClient, 'user'>, userId: string): Promise<string> {
    const u = await tx.user.findFirst({ where: { id: userId } });
    return u ? `${u.firstName} ${u.lastName} (${u.code})` : 'Un utilisateur';
  }

  /** Enregistre la notification pour chaque destinataire ; renvoie leur nombre. */
  async notify(tx: Prisma.TransactionClient, input: NotifyInput): Promise<number> {
    const recipients = new Set(input.to.userIds ?? []);
    if (input.to.permission) {
      const modules = await this.modules.activeModules(input.companyId);
      if (isPermissionModuleActive(input.to.permission, modules)) {
        const users = await tx.user.findMany({
          where: {
            companyId: input.companyId,
            status: 'ACTIVE',
            deletedAt: null,
            role: { rolePermissions: { some: { permissionCode: input.to.permission } } },
          },
          select: { id: true },
        });
        for (const u of users) recipients.add(u.id);
      }
    }
    if (input.actorUserId) recipients.delete(input.actorUserId);
    if (recipients.size === 0) return 0;
    await tx.notification.createMany({
      data: [...recipients].map((userId) => ({
        id: uuidv7(),
        companyId: input.companyId,
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        createdByUserId: input.actorUserId ?? null,
      })),
    });
    return recipients.size;
  }

  async list(actor: AuthUser, query: NotificationListQuery): Promise<Page<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = {
      userId: actor.userId,
      deletedAt: null,
      ...(query.unread === 'true' ? { readAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.notification.findMany({
        where: query.cursor ? { AND: [where, decodeCursor(query.cursor)] } : where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.db.notification.count({ where }),
    ]);
    const page = rows.slice(0, query.limit);
    return {
      data: page.map(toNotificationDto),
      nextCursor: rows.length > query.limit ? encodeCursor(page[page.length - 1]!) : null,
      total,
    };
  }

  async unreadCount(actor: AuthUser): Promise<{ count: number }> {
    return {
      count: await this.db.notification.count({
        where: { userId: actor.userId, readAt: null, deletedAt: null },
      }),
    };
  }

  /** Marque lues des notifications de l'utilisateur ; une autre que les siennes est ignorée. */
  async markRead(
    tx: Pick<Prisma.TransactionClient, 'notification'>,
    userId: string,
    ids: string[],
  ): Promise<number> {
    const { count } = await tx.notification.updateMany({
      where: { id: { in: ids }, userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }

  async read(actor: AuthUser, id: string): Promise<NotificationDto> {
    const n = await this.db.notification.findFirst({
      where: { id, userId: actor.userId, deletedAt: null },
    });
    if (!n) throw notFound('Notification introuvable.');
    await this.markRead(this.db as unknown as Prisma.TransactionClient, actor.userId, [id]);
    return toNotificationDto(
      await this.db.notification.findFirstOrThrow({ where: { id, userId: actor.userId } }),
    );
  }

  async readAll(actor: AuthUser): Promise<void> {
    await this.db.notification.updateMany({
      where: { userId: actor.userId, readAt: null, deletedAt: null },
      data: { readAt: new Date() },
    });
  }
}
