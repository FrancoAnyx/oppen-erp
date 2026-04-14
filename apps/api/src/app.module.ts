import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { CoreModule }       from './modules/core/core.module';
import { AuthModule }       from './modules/auth/auth.module';
import { InventoryModule }  from './modules/inventory/inventory.module';
import { SalesModule }      from './modules/sales/sales.module';
import { PurchasesModule }  from './modules/purchases/purchases.module';
import { FiscalModule }     from './modules/fiscal/fiscal.module';
import { DeliveryModule }   from './modules/delivery/delivery.module';
import { AccountingModule } from './modules/accounting/accounting.module';

import { DomainExceptionFilter } from './infrastructure/http/domain-exception.filter';
import { LoggingInterceptor, TransformInterceptor } from './common/interceptors/interceptors';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-proxy.guard';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'], cache: true }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => [
        { name: 'default', ttl: 60_000, limit: 120 },
        { name: 'auth',    ttl: 60_000, limit: 10  },
      ],
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host:     config.get('REDIS_HOST', 'localhost'),
          port:     config.get<number>('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000, age: 86400 },
          removeOnFail:    { count: 5000, age: 604800 },
        },
      }),
    }),

    CoreModule,
    AuthModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    FiscalModule,
    DeliveryModule,
    AccountingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER,      useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_GUARD,       useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule {}
