import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../infrastructure/database/prisma.service';

/**
 * Health checks para load balancers y orquestadores.
 *
 * /healthz → liveness probe: el proceso está vivo (no se cuelga)
 * /health  → readiness probe: el servicio puede atender requests (DB ok)
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  liveness(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('health')
  async readiness(): Promise<{
    status: 'ok' | 'degraded';
    checks: { database: 'up' | 'down' };
    timestamp: string;
  }> {
    let dbStatus: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch {
      // ignore — reportamos down
    }
    return {
      status: dbStatus === 'up' ? 'ok' : 'degraded',
      checks: { database: dbStatus },
      timestamp: new Date().toISOString(),
    };
  }
}

