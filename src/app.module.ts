// ============================================================
// apps/api/src/app.module.ts
// Módulo raíz — registra TODOS los bounded contexts
// ============================================================

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';

// Módulos de dominio
import { CoreModule }      from './modules/core/core.module';
import { AuthModule }      from './modules/auth/auth.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule }     from './modules/sales/sales.module';
import { PurchaseModule }  from './modules/purchase/purchase.module';
import { FiscalModule }    from './modules/fiscal/fiscal.module';
import { FinanceModule }   from './modules/finance/finance.module';

// Infraestructura transversal
import { DomainExceptionFilter }    from './common/filters/domain-exception.filter';
import { LoggingInterceptor }       from './common/interceptors/logging.interceptor';
import { TransformInterceptor }     from './common/interceptors/transform.interceptor';
import { TenantInterceptor }        from './common/interceptors/tenant.interceptor';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-proxy.guard';

// Health check
import { HealthModule } from './modules/core/health/health.module';

@Module({
  imports: [
    // ── Configuración global ────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.production', '.env'],
      cache: true,
    }),

    // ── Rate limiting (protección brute-force) ──────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: 60_000,          // ventana 1 minuto
          limit: 120,           // 120 req/min por IP
        },
        {
          name: 'auth',
          ttl: 60_000,
          limit: 10,            // 10 intentos de login/min
        },
      ],
    }),

    // ── Queue (BullMQ) con Redis ────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'redis'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000, age: 86400 },  // 24hs
          removeOnFail:    { count: 5000, age: 604800 },  // 7 días
        },
      }),
    }),

    // ── Bounded Contexts ────────────────────────────────────
    CoreModule,
    AuthModule,
    HealthModule,
    InventoryModule,
    SalesModule,
    PurchaseModule,
    FiscalModule,
    FinanceModule,
  ],

  providers: [
    // Filtro global: convierte DomainError → HTTP response con código
    { provide: APP_FILTER, useClass: DomainExceptionFilter },

    // Log de requests + metadata de timing
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },

    // Envuelve respuestas en { data, meta, timestamp }
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },

    // Inyecta tenantId desde JWT en el contexto de cada request
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },

    // Rate limiter (respeta X-Forwarded-For detrás de nginx)
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule {}
