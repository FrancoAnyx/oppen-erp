import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  ISalesOrderRepository,
  SALES_ORDER_REPOSITORY,
} from '../../domain/repositories/sales.repositories';

export interface CancelSalesOrderCommand {
  tenantId: string;
  orderId: string;
  cancelledById: string;
  reason: string;
}

/**
 * CancelSalesOrderUseCase — cancela una OV y libera todas las reservas de stock.
 *
 * ORDEN CRÍTICO:
 *   1. Cancelar los stock moves de reserva (en Inventory)
 *   2. Recién entonces transicionar el aggregate a CANCELLED
 *   3. Persistir
 *
 * Si la OV ya está INVOICED, rechazar (hay que usar Nota de Crédito).
 * Si la OV está en DRAFT, cancelar directamente sin tocar stock.
 */
@Injectable()
export class CancelSalesOrderUseCase {
  private readonly logger = new Logger(CancelSalesOrderUseCase.name);

  constructor(
    @Inject(SALES_ORDER_REPOSITORY)
    private readonly salesOrderRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CancelSalesOrderCommand): Promise<void> {
    const order = await this.salesOrderRepo.findById(cmd.tenantId, cmd.orderId);
    if (!order) {
      throw new NotFoundError('SalesOrder', cmd.orderId);
    }

    if (order.currentState === 'INVOICED') {
      throw new BusinessRuleError(
        'SO_ALREADY_INVOICED',
        'Cannot cancel an invoiced order — use a credit note (NC) instead',
        { orderId: cmd.orderId },
      );
    }

    if (order.currentState === 'CANCELLED') {
      // Idempotente — ya estaba cancelada
      this.logger.warn(`CancelSalesOrder called on already-cancelled order ${cmd.orderId}`);
      return;
    }

    // ---- Liberar reservas de stock ----
    // Solo si la OV fue confirmada (puede tener moves en CONFIRMED)
    if (order.currentState !== 'DRAFT') {
      const moveIds = order.lines
        .map((l) => l.reserveMoveId)
        .filter((id): id is string => id !== undefined);

      if (moveIds.length > 0) {
        await this.releaseStockReservations(cmd.tenantId, moveIds, cmd.reason);
      }
    }

    // ---- Transicionar aggregate ----
    order.cancel(cmd.reason);

    // ---- Persistir ----
    await this.salesOrderRepo.update(order);

    this.logger.log(
      `SalesOrder ${order.orderNumber} cancelled by user ${cmd.cancelledById}. Reason: ${cmd.reason}`,
    );
  }

  /**
   * Cancela los stock moves de reserva asociados a la OV.
   *
   * Usamos UPDATE directo en lugar de pasar por el aggregate de StockMove
   * porque: (1) son muchos moves a la vez y (2) el estado de la OV ya garantiza
   * que son CONFIRMED — no hay que re-validar la state machine.
   *
   * Si algún move ya fue DONE (entrega parcial), NO lo cancelamos — esa
   * mercadería ya salió. Solo cancelamos los CONFIRMED (reservados pero no entregados).
   */
  private async releaseStockReservations(
    tenantId: string,
    moveIds: string[],
    reason: string,
  ): Promise<void> {
    const updated = await this.prisma.stockMove.updateMany({
      where: {
        id: { in: moveIds },
        tenantId,
        state: 'CONFIRMED', // DONE moves ya ejecutados — no tocar
      },
      data: {
        state: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `SO cancelled: ${reason}`.substring(0, 500),
      },
    });

    this.logger.log(
      `Released ${updated.count} stock reservation(s) for cancelled SO`,
      { moveIds, reason },
    );
  }
}




