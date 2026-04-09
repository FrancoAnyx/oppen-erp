import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './infrastructure/database/prisma.module';
import { DomainExceptionFilter } from './infrastructure/http/domain-exception.filter';
import { TenantContextMiddleware } from './infrastructure/http/tenant-context.middleware';
import { HealthController } from './health/health.controller';
import { CoreModule } from './modules/core/core.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { SalesModule } from './modules/sales/sales.module';
import { AuthModule } from './modules/auth/auth.module';
import { PurchasesModule } from './modules/purchases/purchases.module';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * AppModule — módulo raíz de la aplicación.
 *
 * Orden de inicialización:
 *   1. AppConfigModule (global)   — valida env, provee ConfigService
 *   2. PrismaModule (global)      — conexión a Postgres
 *   3. Bounded contexts           — Core, Inventory, (futuros: Sales, Purchases, Fiscal)
 *
 * Providers globales:
 *   - ValidationPipe: aplica class-validator a TODOS los DTOs automáticamente
 *   - DomainExceptionFilter: captura todos los errores y los traduce a HTTP
 *
 * Middleware:
 *   - TenantContextMiddleware: inyecta req.tenantId en todas las rutas
 */
@Module({
  imports: [
    // Cross-cutting (globales)
    AppConfigModule,
    PrismaModule,

    // Auth (global — debe ir antes de los bounded contexts)
    AuthModule,

    // Bounded contexts
    CoreModule,
    InventoryModule,
    SalesModule,
    PurchasesModule,
    // FiscalModule,     — fase 2
    // FiscalModule,     — fase 2
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,              // elimina campos no declarados en el DTO
        forbidNonWhitelisted: true,   // 400 si mandan campos extra
        transform: true,              // aplica @Transform y convierte tipos
        transformOptions: { enableImplicitConversion: false },
        stopAtFirstError: false,      // acumula todos los errores de un request
      }),
    },
    {
      provide: APP_FILTER,
      useFactory: () => new DomainExceptionFilter(isProduction),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}

