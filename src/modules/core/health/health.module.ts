// ============================================================
// src/modules/core/health/health.module.ts
// ============================================================

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { CoreModule } from '../core.module';

@Module({
  imports: [
    CoreModule,
    BullModule.registerQueue({ name: 'arca-invoicing' }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
