import { Module } from '@nestjs/common';
import { ProductService } from './application/product.service';
import { StockCalculatorService } from './application/services/stock-calculator.service';
import { StockReservationService } from './application/services/stock-reservation.service';
import { StockReceiptService } from './application/services/stock-receipt.service';
import {
  PRODUCT_REPOSITORY,
  LOCATION_REPOSITORY,
  STOCK_MOVE_REPOSITORY,
} from './domain/repositories/inventory.repositories';
import { PrismaProductRepository } from './infrastructure/persistence/prisma-product.repository';
import { PrismaLocationRepository } from './infrastructure/persistence/prisma-location.repository';
import { PrismaStockMoveRepository } from './infrastructure/persistence/prisma-stock-move.repository';
import { ProductController } from './interfaces/http/product.controller';

/**
 * InventoryModule — bounded context de inventario.
 *
 * EXPORTS (lo que otros módulos pueden consumir):
 *   - StockReservationService: Sales lo usa al confirmar OVs
 *   - StockCalculatorService:  Sales/Dashboards leen stock sin lock
 *   - StockReceiptService:     Purchases lo usa al recibir OCs
 *   - ProductService:          Sales valida productos existentes y activos
 *
 * NO SE EXPORTAN:
 *   - Los repositorios Prisma (detalles de infraestructura)
 *   - Las entities de dominio (mutables — solo las usa el módulo internamente)
 *   - Los VOs de stock quantities (se comparten via public-api.ts como tipos)
 *
 * Los otros módulos deben importar desde `./public-api.js`, no desde este archivo.
 */
@Module({
  controllers: [ProductController],
  providers: [
    // Application services
    ProductService,
    StockCalculatorService,
    StockReservationService,
    StockReceiptService,
    // Repository bindings (port → adapter)
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: LOCATION_REPOSITORY, useClass: PrismaLocationRepository },
    { provide: STOCK_MOVE_REPOSITORY, useClass: PrismaStockMoveRepository },
  ],
  exports: [
    ProductService,
    StockCalculatorService,
    StockReservationService,
    StockReceiptService,
  ],
})
export class InventoryModule {}

