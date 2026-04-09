import { Inject, Injectable, Logger } from '@nestjs/common';
import { Quantity, BusinessRuleError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  ILocationRepository,
  LOCATION_REPOSITORY,
} from '../../domain/repositories/inventory.repositories';

/**
 * StockReceiptService — crea stock moves que entran al depósito.
 *
 * Casos típicos:
 *   1. Stock inicial (seed de datos al migrar desde otro sistema)
 *   2. Recepción de una orden de compra
 *   3. Devolución de cliente aceptada (RMA aprobada)
 *   4. Ajuste manual positivo
 *
 * En el caso 1 y 4 el move va directo a DONE (afecta physical inmediatamente).
 * En el caso 2 se crea en CONFIRMED cuando se emite la OC (afecta incoming)
 * y se marca DONE al recibir físicamente.
 *
 * Por ahora implementamos el camino simple: DONE directo. La integración con
 * Purchases llega en el siguiente módulo.
 */
@Injectable()
export class StockReceiptService {
  private readonly logger = new Logger(StockReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOCATION_REPOSITORY)
    private readonly locationRepo: any,
  ) {}

  /**
   * Recepción directa a DONE. Usado para stock inicial o ajustes positivos.
   * Crea un move SUPPLIER → INTERNAL en estado DONE.
   */
  async receiveDirect(input: {
    tenantId: string;
    productId: string;
    quantity: Quantity;
    destLocationId: string;
    originDocType: 'RECEIPT' | 'ADJUSTMENT';
    originDocId: string;
    unitCost?: string;
    unitCostUsd?: string;
    fxRate?: string;
    createdById: string;
  }): Promise<{ moveId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Validar producto
      const product = await tx.product.findFirst({
        where: { id: input.productId, tenantId: input.tenantId, isActive: true },
        select: { id: true, sku: true, tracking: true },
      });
      if (!product) throw new NotFoundError('Product', input.productId);

      // 2. Validar location destino (debe ser INTERNAL)
      const destLoc = await tx.location.findFirst({
        where: { id: input.destLocationId, tenantId: input.tenantId, isActive: true },
        select: { id: true, locationType: true },
      });
      if (!destLoc) throw new NotFoundError('Location', input.destLocationId);
      if (destLoc.locationType !== 'INTERNAL') {
        throw new BusinessRuleError(
          'RECEIVE_INTO_NON_INTERNAL',
          'Can only receive into INTERNAL locations',
          { locationType: destLoc.locationType },
        );
      }

      // 3. Source location virtual SUPPLIER
      const supplierLoc = await tx.location.findFirst({
        where: {
          tenantId: input.tenantId,
          locationType: 'SUPPLIER',
          isActive: true,
        },
        select: { id: true },
      });
      if (!supplierLoc) {
        throw new NotFoundError('Location', { locationType: 'SUPPLIER' });
      }

      // 4. Crear el move DONE directamente
      const move = await tx.stockMove.create({
        data: {
          tenantId: input.tenantId,
          productId: input.productId,
          quantity: input.quantity.toString(),
          uom: 'UN',
          sourceLocationId: supplierLoc.id,
          destLocationId: input.destLocationId,
          state: 'DONE',
          originDocType: input.originDocType,
          originDocId: input.originDocId,
          unitCost: input.unitCost ?? null,
          unitCostUsd: input.unitCostUsd ?? null,
          fxRate: input.fxRate ?? null,
          scheduledDate: new Date(),
          doneDate: new Date(),
          createdById: input.createdById,
        },
        select: { id: true },
      });

      this.logger.log(
        `Received ${input.quantity} of ${product.sku} into location ${destLoc.id} [move=${move.id}]`,
      );

      return { moveId: move.id };
    });
  }

  /**
   * Confirma la entrega de un move previamente reservado:
   * lo pasa de CONFIRMED → DONE. Esto mueve la cantidad de "committed"
   * a "physical-subtraction" (porque el producto ya salió del depósito).
   */
  async confirmDelivery(input: {
    tenantId: string;
    moveId: string;
  }): Promise<void> {
    const result = await this.prisma.stockMove.updateMany({
      where: {
        id: input.moveId,
        tenantId: input.tenantId,
        state: { in: ['CONFIRMED', 'ASSIGNED'] },
      },
      data: {
        state: 'DONE',
        doneDate: new Date(),
      },
    });

    if (result.count === 0) {
      throw new BusinessRuleError(
        'MOVE_NOT_CONFIRMABLE',
        'Cannot confirm delivery: move not found or not in CONFIRMED/ASSIGNED state',
        { moveId: input.moveId },
      );
    }
  }
}




