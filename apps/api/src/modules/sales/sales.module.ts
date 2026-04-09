import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CreateSalesOrderUseCase } from './application/use-cases/create-sales-order.use-case';
import { ConfirmSalesOrderUseCase } from './application/use-cases/confirm-sales-order.use-case';
import { CancelSalesOrderUseCase } from './application/use-cases/cancel-sales-order.use-case';
import { SALES_ORDER_REPOSITORY } from './domain/repositories/sales.repositories';
import { PrismaSalesOrderRepository } from './infrastructure/persistence/prisma-sales-order.repository';
import { SalesController } from './interfaces/http/sales.controller';

/**
 * SalesModule — bounded context de ventas.
 *
 * Dependencias externas (importadas):
 *   - InventoryModule: provee StockReservationService para que
 *     ConfirmSalesOrderUseCase pueda reservar stock al confirmar una OV.
 *     NUNCA se importa directamente desde ./inventory/domain/... — solo
 *     a través del public-api.ts del módulo.
 *
 * Exports:
 *   - Ninguno por ahora. Cuando FiscalModule necesite marcar OVs como
 *     INVOICED, exportaremos el use case o servicio correspondiente.
 */
@Module({
  imports: [
    // InventoryModule exporta StockReservationService, que es la única
    // dependencia cross-module que necesita Sales hoy.
    InventoryModule,
  ],
  controllers: [SalesController],
  providers: [
    // Use cases (application layer)
    CreateSalesOrderUseCase,
    ConfirmSalesOrderUseCase,
    CancelSalesOrderUseCase,

    // Repository binding (port → adapter)
    {
      provide: SALES_ORDER_REPOSITORY,
      useClass: PrismaSalesOrderRepository,
    },
  ],
  exports: [
    // Exportado para que Fiscal pueda invocar markInvoiced en el futuro
    SALES_ORDER_REPOSITORY,
  ],
})
export class SalesModule {}

