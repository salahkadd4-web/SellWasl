import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
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
}
