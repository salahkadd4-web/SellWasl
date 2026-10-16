import { Controller, Get, Req, ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';
import { webProxyClientIp } from '../common/client-ip';
import { Public } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';

/** Santé de l'API et de la base (architecture §17). */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok'; time: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    }
    return { status: 'ok', database: 'ok', time: new Date().toISOString() };
  }

  /**
   * Adresse du client vue par l'API, pour régler TRUST_PROXY après le déploiement
   * (docs/deployment.md, étape 13). Ne renvoie que ce que l'appelant a lui-même envoyé ou montré.
   */
  @Get('ip')
  ip(@Req() req: Request): { ip: string | null; viaWeb: boolean } {
    return {
      ip: req.ip ?? null,
      viaWeb: webProxyClientIp(req.headers, process.env.WEB_PROXY_SECRET) !== undefined,
    };
  }
}
