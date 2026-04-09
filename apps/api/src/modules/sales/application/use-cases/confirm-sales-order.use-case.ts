import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Quantity, NotFoundError, BusinessRuleError, IllegalStateTransitionError } from '@erp/shared';
import { StockReservationService } from '../../../inventory/public-api';
import {
  ISalesOrderRepository,
  SALES_ORDER_REPOSITORY,
} from '../../domain/repositories/sales.repositories';
import type { ConfirmLineResult } from '../../domain/entities/sales-order';

export interface ConfirmSalesOrderCommand {
  tenantId: string;
  orderId: string;
  confirmedById: string;
  /** Tipo de cambio al momento de confirmar (si el negocio lo provee) */
  fxRate?: string;
  /**
   * Si true, las líneas sin stock suficiente se marcan como backorder
   * en lugar de rechazar la confirmación completa.
   * Default: true (comportamiento de reseller tech — confirmar siempre,
   * luego generar OC al proveedor para el backorder).
   */
  allowBackorder?: boolean;
}

export interface ConfirmSalesOrderResult {
  orderId: string;
  orderNumber: number;
  requiresBackorder: boolean;
  /** Líneas que quedaron en backorder */
  backorderedLines: Array<{
    lineId: string;
    productId: string;
    quantity: string;
  }>;
}

/**
 * ConfirmSalesOrderUseCase — transiciona la OV de DRAFT a CONFIRMED.
 *
 * Es el use case más crítico del módulo Sales porque cruza bounded contexts:
 *
 *   Sales → [StockReservationService] → Inventory
 *
 * FLUJO:
 *   1. Cargar la OV y validar que esté en DRAFT
 *   2. Para cada línea, intentar reservar stock llamando a
 *      StockReservationService.reserveForCustomer()
 *   3. Si la reserva falla por BusinessRuleError('INSUFFICIENT_STOCK'):
 *      - Si allowBackorder=true: marcar esa línea como backorder
 *      - Si allowBackorder=false: propagar el error (la OV no se confirma)
 *   4. Pasar los resultados al aggregate (order.confirm(lineResults))
 *   5. Persistir con optimistic locking
 *
 * CONCURRENCIA:
 *   StockReservationService ya maneja concurrencia con transacciones
 *   SERIALIZABLE + retry exponencial. Si después del retry sigue fallando,
 *   propagamos ConcurrencyError al caller (HTTP 409).
 *
 * IDEMPOTENCIA:
 *   Si la OV ya está CONFIRMED, retornamos idempotentemente el estado actual
 *   sin crear movimientos duplicados.
 */
@Injectable()
export class ConfirmSalesOrderUseCase {
  private readonly logger = new Logger(ConfirmSalesOrderUseCase.name);

  constructor(
    @Inject(SALES_ORDER_REPOSITORY)
    private readonly salesOrderRepo: any,
    private readonly stockReservation: StockReservationService,
  ) {}

  async execute(cmd: ConfirmSalesOrderCommand): Promise<ConfirmSalesOrderResult> {
    const allowBackorder = cmd.allowBackorder ?? true;

    // ---- 1. Cargar OV ----
    const order = await this.salesOrderRepo.findById(cmd.tenantId, cmd.orderId);
    if (!order) {
      throw new NotFoundError('SalesOrder', cmd.orderId);
    }

    // ---- Idempotencia ----
    if (order.currentState === 'CONFIRMED') {
      this.logger.warn(
        `ConfirmSalesOrder called on already-confirmed order ${cmd.orderId} — returning current state`,
      );
      const backorderedLines = order.lines
        .filter((l) => l.requiresBackorder)
        .map((l) => ({
          lineId: l.id,
          productId: l.productId,
          quantity: l.quantity,
        }));
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        requiresBackorder: order.requiresBackorder,
        backorderedLines,
      };
    }

    if (order.currentState !== 'DRAFT') {
      throw new IllegalStateTransitionError('SalesOrder', order.currentState, 'confirm');
    }

    // ---- 2. Reservar stock por línea ----
    const lineResults: ConfirmLineResult[] = [];
    const backorderedLines: Array<{
      lineId: string;
      productId: string;
      quantity: string;
    }> = [];

    for (const line of order.lines) {
      const result = await this.attemptReservation({
        tenantId: cmd.tenantId,
        orderId: cmd.orderId,
        line: {
          id: line.id,
          productId: line.productId,
          quantity: line.quantity,
        },
        confirmedById: cmd.confirmedById,
        allowBackorder,
      });

      lineResults.push(result);

      if (result.backordered) {
        backorderedLines.push({
          lineId: line.id,
          productId: line.productId,
          quantity: line.quantity,
        });
        this.logger.log(
          `Line ${line.id} (product ${line.productId}) marked as backorder — insufficient stock`,
        );
      } else {
        this.logger.log(
          `Line ${line.id} reserved — moveId=${result.moveId}`,
        );
      }
    }

    // ---- 3. Aplicar resultados al aggregate ----
    order.confirm(lineResults, cmd.fxRate);

    // ---- 4. Persistir con optimistic locking ----
    const saved = await this.salesOrderRepo.update(order);

    // ---- 5. Log de backorders para que Purchases los consuma ----
    if (saved.requiresBackorder) {
      this.logger.warn(
        `SalesOrder ${saved.orderNumber} confirmed with ${backorderedLines.length} backorder line(s) — ` +
          `Purchases module should generate a PO suggestion`,
        { orderId: saved.id, backorderedLines },
      );
    }

    return {
      orderId: saved.id,
      orderNumber: saved.orderNumber,
      requiresBackorder: saved.requiresBackorder,
      backorderedLines,
    };
  }

  /**
   * Intenta reservar una línea. Si falla por stock insuficiente y
   * allowBackorder=true, devuelve { backordered: true } en lugar de tirar.
   *
   * Aísla el error handling de cada línea para que el loop externo sea limpio.
   */
  private async attemptReservation(params: {
    tenantId: string;
    orderId: string;
    line: { id: string; productId: string; quantity: string };
    confirmedById: string;
    allowBackorder: boolean;
  }): Promise<ConfirmLineResult> {
    const { tenantId, orderId, line, confirmedById, allowBackorder } = params;

    try {
      const { moveId } = await this.stockReservation.reserveForCustomer({
        tenantId,
        productId: line.productId,
        quantity: Quantity.of(line.quantity),
        originDocType: 'SO',
        originDocId: orderId,
        originLineId: line.id,
        createdById: confirmedById,
      });

      return {
        lineId: line.id,
        productId: line.productId,
        quantity: new Decimal(line.quantity),
        moveId,
        backordered: false,
      };
    } catch (err) {
      // INSUFFICIENT_STOCK es el código que lanza StockReservationService
      if (
        err instanceof BusinessRuleError &&
        err.code === 'INSUFFICIENT_STOCK' &&
        allowBackorder
      ) {
        return {
          lineId: line.id,
          productId: line.productId,
          quantity: new Decimal(line.quantity),
          moveId: undefined,
          backordered: true,
        };
      }
      // Cualquier otro error (concurrencia, producto no existe, etc.) lo re-throw
      throw err;
    }
  }
}





