// ============================================================
// src/modules/core/health/health.controller.ts
// GET /api/v1/health — Usado por Docker healthcheck y monitoreo
// ============================================================

import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../infrastructure/persistence/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    arca: 'ok' | 'contingency' | 'unknown';
  };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('arca-invoicing') private readonly arcaQueue: Queue,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const [dbOk, redisOk] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);

    const allOk = dbOk && redisOk;
    const anyDown = !dbOk || !redisOk;

    return {
      status: allOk ? 'ok' : anyDown ? 'down' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '1.0.0',
      services: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        arca: process.env.FEATURE_ARCA_LIVE === 'true' ? 'ok' : 'contingency',
      },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      const client = this.arcaQueue.client;
      await (await client).ping();
      return true;
    } catch {
      return false;
    }
  }
}
