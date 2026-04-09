import { Module } from '@nestjs/common';
import { CreatePurchaseOrderUseCase } from './application/use-cases/create-purchase-order.use-case';
import { ConfirmPurchaseOrderUseCase } from './application/use-cases/confirm-purchase-order.use-case';
import { ReceivePurchaseOrderUseCase } from './application/use-cases/receive-purchase-order.use-case';
import { CreatePOFromBackordersUseCase } from './application/use-cases/create-po-from-backorders.use-case';
import { PURCHASE_ORDER_REPOSITORY } from './domain/repositories/purchases.repositories';
import { PrismaPurchaseOrderRepository } from './infrastructure/persistence/prisma-purchase-order.repository';
import { PurchasesController } from './interfaces/http/purchases.controller';

/**
 * PurchasesModule — bounded context de compras.
 *
 * NO importa InventoryModule directamente — accede a los stock moves
 * vía PrismaService dentro de sus use cases (los moves de Purchases
 * son CONFIRMED/DONE creados directamente, no via StockReservationService).
 *
 * Sí exporta el repositorio para que Fiscal pueda consultarlo
 * si necesita datos de OC para comprobantes de compra (fase 2).
 */
@Module({
  controllers: [PurchasesController],
  providers: [
    CreatePurchaseOrderUseCase,
    ConfirmPurchaseOrderUseCase,
    ReceivePurchaseOrderUseCase,
    CreatePOFromBackordersUseCase,
    { provide: PURCHASE_ORDER_REPOSITORY, useClass: PrismaPurchaseOrderRepository },
  ],
  exports: [PURCHASE_ORDER_REPOSITORY],
})
export class PurchasesModule {}

