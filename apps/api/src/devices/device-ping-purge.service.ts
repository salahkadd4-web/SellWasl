import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** Durée de conservation des signaux de vie et positions (BR-JOU-09). */
export const PING_RETENTION_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

/** Verrou PostgreSQL : une seule purge à la fois, même avec plusieurs instances de l'API. */
const LOCK_KEY = 21_0090_1;

/** Purge de nuit des positions de plus de 90 jours, toutes entreprises (BR-JOU-09). */
@Injectable()
export class DevicePingPurgeService {
  private readonly logger = new Logger(DevicePingPurgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 45 2 * * *', { name: 'device-ping-purge' })
  async nightly(): Promise<void> {
    const purged = await this.run();
    this.logger.log(`Positions de plus de ${PING_RETENTION_DAYS} jours supprimées : ${purged}.`);
  }

  /** Une exécution ; renvoie le nombre de positions supprimées (0 si une autre tourne déjà). */
  async run(now = new Date()): Promise<number> {
    const [lock] = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`;
    if (!lock?.ok) return 0;
    try {
      const { count } = await this.prisma.devicePing.deleteMany({
        where: { recordedAt: { lt: new Date(now.getTime() - PING_RETENTION_DAYS * DAY) } },
      });
      return count;
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
    }
  }
}
