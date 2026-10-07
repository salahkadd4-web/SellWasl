import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push.provider';

/** Verrou PostgreSQL : un seul envoyeur, même avec plusieurs instances de l'API. */
const LOCK_KEY = 240_024;
/** Lot d'Expo Push. */
const BATCH = 100;
/** Une notification plus ancienne n'est plus poussée (elle reste dans l'application). */
const MAX_AGE_MS = 24 * 3600_000;
const auto = () => process.env.PUSH_AUTO !== 'off';

/**
 * Envoi push des notifications (spec phase 24 §2.2) : à intervalle régulier et juste après une
 * action. Chaque notification est marquée envoyée (`pushedAt`) : rien n'est perdu après une panne,
 * rien n'est envoyé deux fois. Système : parcourt toutes les entreprises, client Prisma non filtré.
 */
@Injectable()
export class PushDispatcher implements OnModuleInit {
  private readonly logger = new Logger('PushDispatcher');
  private pending: Promise<number> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  onModuleInit(): void {
    // Juste après une action : la transaction est validée, l'envoi part sans attendre le minuteur
    this.notifications.onNotify(() => {
      if (auto()) setTimeout(() => void this.safeDispatch(), 200);
    });
  }

  @Interval(10_000)
  tick(): void {
    if (auto()) void this.safeDispatch();
  }

  private async safeDispatch(): Promise<void> {
    try {
      this.pending ??= this.dispatch().finally(() => (this.pending = null));
      await this.pending;
    } catch (error) {
      this.logger.warn(`Envoi push en échec : ${String(error)}`);
    }
  }

  /** Envoie les notifications en attente ; renvoie le nombre de messages envoyés. */
  dispatch(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
        if (!lock?.ok) return 0;
        const rows = await tx.notification.findMany({
          where: {
            pushedAt: null,
            deletedAt: null,
            createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) },
          },
          orderBy: { createdAt: 'asc' },
          take: 500,
        });
        if (rows.length === 0) return 0;
        const revoked = rows
          .filter((n) => n.type === 'DEVICE_REVOKED')
          .map((n) => (n.data as { deviceId?: string } | null)?.deviceId)
          .filter((id): id is string => typeof id === 'string');
        const devices = await tx.device.findMany({
          where: {
            pushToken: { not: null },
            OR: [
              { userId: { in: [...new Set(rows.map((n) => n.userId))] }, status: 'ACTIVE' },
              { id: { in: revoked } },
            ],
          },
          select: { id: true, userId: true, status: true, pushToken: true },
        });

        const messages: (PushMessage & { deviceId: string })[] = [];
        for (const n of rows) {
          const data = (n.data ?? {}) as { href?: string; deviceId?: string };
          const targets = devices.filter((d) =>
            n.type === 'DEVICE_REVOKED' && data.deviceId
              ? d.id === data.deviceId
              : d.userId === n.userId && d.status === 'ACTIVE',
          );
          for (const d of targets)
            messages.push({
              deviceId: d.id,
              to: d.pushToken!,
              title: n.title,
              body: n.body,
              data: { notificationId: n.id, type: n.type, href: data.href ?? null },
            });
        }

        let sent = 0;
        const dead = new Set<string>();
        for (let i = 0; i < messages.length; i += BATCH) {
          const batch = messages.slice(i, i + BATCH);
          const results = await this.provider.send(batch.map(({ deviceId: _d, ...m }) => m));
          results.forEach((r, k) => {
            if (r.ok) sent += 1;
            else if (r.error === 'DeviceNotRegistered') dead.add(batch[k]!.deviceId);
          });
        }
        // Jeton refusé par Expo : l'application le renverra à la prochaine connexion
        if (dead.size > 0)
          await tx.device.updateMany({
            where: { id: { in: [...dead] } },
            data: { pushToken: null },
          });
        await tx.notification.updateMany({
          where: { id: { in: rows.map((n) => n.id) } },
          data: { pushedAt: new Date() },
        });
        return sent;
      },
      { timeout: 60_000 },
    );
  }
}
