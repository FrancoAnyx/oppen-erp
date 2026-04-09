import { Decimal } from 'decimal.js';
import {
  BusinessRuleError,
  ValidationError,
  IllegalStateTransitionError,
} from '@erp/shared';
import { SalesOrderLine, type CreateSalesOrderLineProps } from './sales-order-line';

// =============================================================================
// Tipos y state machine
// =============================================================================

export type SalesOrderState =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PARTIAL'
  | 'DELIVERED'
  | 'INVOICED'
  | 'CANCELLED';

/**
 * Transiciones válidas de la state machine.
 *
 * DRAFT      → CONFIRMED | CANCELLED
 * CONFIRMED  → PARTIAL | DELIVERED | CANCELLED
 * PARTIAL    → DELIVERED | CANCELLED
 * DELIVERED  → INVOICED | CANCELLED
 * INVOICED   → (terminal — solo NC en módulo Fiscal)
 * CANCELLED  → (terminal)
 */
const VALID_TRANSITIONS: Record<SalesOrderState, ReadonlyArray<SalesOrderState>> = {
  DRAFT:     ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIAL', 'DELIVERED', 'CANCELLED'],
  PARTIAL:   ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['INVOICED', 'CANCELLED'],
  INVOICED:  [],
  CANCELLED: [],
};

// =============================================================================
// Interfaces de estado
// =============================================================================

export interface SalesOrderProps {
  id: string;
  tenantId: string;
  orderNumber: number;
  customerId: string;
  state: SalesOrderState;
  currency: string;
  fxRateAtConfirm?: string;
  paymentTermDays: number;
  deliveryAddress?: string;
  notes?: string;
  requiresBackorder: boolean;
  subtotalArs: string;
  taxAmountArs: string;
  totalArs: string;
  version: number;
  createdById: string;
  confirmedAt?: Date;
  deliveredAt?: Date;
  invoicedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
  lines: SalesOrderLine[];
}

export interface CreateSalesOrderProps {
  tenantId: string;
  customerId: string;
  orderNumber: number;
  paymentTermDays?: number;
  deliveryAddress?: string;
  notes?: string;
  createdById: string;
  lines: Omit<CreateSalesOrderLineProps, 'tenantId' | 'orderId'>[];
}

// ---- Result types para operaciones ----

export interface ConfirmLineResult {
  lineId: string;
  productId: string;
  quantity: Decimal;
  moveId?: string;      // undefined si fue a backorder
  backordered: boolean;
}

// =============================================================================
// Aggregate root
// =============================================================================

/**
 * SalesOrder — aggregate root del bounded context Sales.
 *
 * INVARIANTES:
 *   - Debe tener al menos una línea (validado en create)
 *   - No se puede editar en estado != DRAFT
 *   - Los totales se recalculan en la app; el trigger de DB es un safety net
 *   - Una vez CONFIRMED, las líneas son inmutables (backorder sí puede cambiar)
 *   - No se puede facturar directamente desde CONFIRMED — hay que entregar primero
 *
 * OPTIMISTIC LOCKING:
 *   El campo `version` se incrementa en cada write en el repositorio.
 *   El repo hace: UPDATE ... WHERE id = $id AND version = $expectedVersion
 *   Si no matchea → ConcurrencyError → el caller refresca y reintenta.
 */
export class SalesOrder {
  private constructor(private state: SalesOrderProps) {}

  // ---- Factories ----

  static create(props: CreateSalesOrderProps): SalesOrder {
    if (props.lines.length === 0) {
      throw new BusinessRuleError(
        'SO_NO_LINES',
        'A sales order must have at least one line',
        { customerId: props.customerId },
      );
    }

    // Crear las líneas con numeración automática
    const lines = props.lines.map((l, idx) =>
      SalesOrderLine.create({
        ...l,
        tenantId: props.tenantId,
        orderId: '',   // se llena en el repo al persistir
        lineNumber: idx + 1,
      }),
    );

    const now = new Date();
    const order = new SalesOrder({
      id: '',
      tenantId: props.tenantId,
      orderNumber: props.orderNumber,
      customerId: props.customerId,
      state: 'DRAFT',
      currency: 'ARS',
      paymentTermDays: props.paymentTermDays ?? 0,
      deliveryAddress: props.deliveryAddress,
      notes: props.notes,
      requiresBackorder: false,
      subtotalArs: '0.00',
      taxAmountArs: '0.00',
      totalArs: '0.00',
      version: 1,
      createdById: props.createdById,
      createdAt: now,
      updatedAt: now,
      lines,
    });

    order.recalcTotals();
    return order;
  }

  static hydrate(props: SalesOrderProps): SalesOrder {
    return new SalesOrder(props);
  }

  // ---- Getters ----

  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get orderNumber(): number { return this.state.orderNumber; }
  get customerId(): string { return this.state.customerId; }
  get currentState(): SalesOrderState { return this.state.state; }
  get version(): number { return this.state.version; }
  get lines(): ReadonlyArray<SalesOrderLine> { return this.state.lines; }
  get requiresBackorder(): boolean { return this.state.requiresBackorder; }
  get subtotalArs(): string { return this.state.subtotalArs; }
  get taxAmountArs(): string { return this.state.taxAmountArs; }
  get totalArs(): string { return this.state.totalArs; }
  get createdById(): string { return this.state.createdById; }
  get paymentTermDays(): number { return this.state.paymentTermDays; }
  get notes(): string | undefined { return this.state.notes; }
  get deliveryAddress(): string | undefined { return this.state.deliveryAddress; }
  get fxRateAtConfirm(): string | undefined { return this.state.fxRateAtConfirm; }
  get confirmedAt(): Date | undefined { return this.state.confirmedAt; }
  get deliveredAt(): Date | undefined { return this.state.deliveredAt; }
  get invoicedAt(): Date | undefined { return this.state.invoicedAt; }
  get cancelledAt(): Date | undefined { return this.state.cancelledAt; }
  get cancelReason(): string | undefined { return this.state.cancelReason; }

  toState(): Readonly<SalesOrderProps> {
    return { ...this.state, lines: [...this.state.lines] };
  }

  // ---- Transiciones de estado ----

  /**
   * Registra el resultado de las reservas de stock por línea.
   * Llamado por ConfirmSalesOrderUseCase DESPUÉS de haber intentado
   * reservar cada línea contra el servicio de inventario.
   *
   * lineResults viene del use case: para cada línea, si hubo stock
   * se llena moveId; si no, backordered = true.
   */
  confirm(lineResults: ConfirmLineResult[], fxRate?: string): void {
    this.assertTransition('confirm', 'CONFIRMED');

    if (lineResults.length !== this.state.lines.length) {
      throw new ValidationError(
        'lineResults must have one entry per line',
        { expected: this.state.lines.length, got: lineResults.length },
      );
    }

    // Aplicar resultados a cada línea
    const updatedLines = this.state.lines.map((line, idx) => {
      const result = lineResults[idx];
      if (!result) {
        throw new ValidationError('Missing line result at index', { idx });
      }

      if (result.backordered) {
        return line.withBackorder();
      }
      if (result.moveId) {
        return line.withReserveMove(result.moveId);
      }
      return line;
    });

    const anyBackorder = lineResults.some((r) => r.backordered);

    this.state.lines = updatedLines;
    this.state.state = 'CONFIRMED';
    this.state.requiresBackorder = anyBackorder;
    this.state.fxRateAtConfirm = fxRate;
    this.state.confirmedAt = new Date();
    this.state.updatedAt = new Date();
    this.recalcTotals();
  }

  /**
   * Registra una entrega parcial. Llama a withDelivery() en cada línea
   * afectada. El caller (DeliverSalesOrderUseCase) construye deliveries
   * a partir del remito.
   */
  markPartialDelivery(
    deliveries: Array<{ lineId: string; quantity: Decimal }>,
  ): void {
    this.assertTransition('markPartialDelivery', 'PARTIAL', 'DELIVERED');

    let allDelivered = true;
    const updatedLines = this.state.lines.map((line) => {
      const delivery = deliveries.find((d) => d.lineId === line.id);
      if (!delivery) return line;

      const updated = line.withDelivery(delivery.quantity);
      if (updated.quantityPendingDelivery.gt(0)) allDelivered = false;
      return updated;
    });

    // Verificar si también hay líneas de backorder pendientes
    const hasBackorderPending = this.state.lines.some(
      (l) => l.requiresBackorder,
    );

    this.state.lines = updatedLines;
    this.state.state = allDelivered && !hasBackorderPending ? 'DELIVERED' : 'PARTIAL';
    this.state.updatedAt = new Date();

    if (this.state.state === 'DELIVERED') {
      this.state.deliveredAt = new Date();
    }
  }

  /**
   * Marca la OV como completamente entregada.
   * Usado cuando el último remito cierra todas las líneas.
   */
  markDelivered(): void {
    this.assertTransition('markDelivered', 'DELIVERED');

    // Verificar que todas las líneas no-backorder estén entregadas
    const hasUndelivered = this.state.lines.some(
      (l) =>
        !l.requiresBackorder &&
        new Decimal(l.quantityDelivered).lt(l.quantityDecimal),
    );

    if (hasUndelivered) {
      throw new BusinessRuleError(
        'SO_LINES_NOT_FULLY_DELIVERED',
        'Cannot mark order as delivered — some lines still have pending delivery',
        { orderId: this.state.id },
      );
    }

    this.state.state = 'DELIVERED';
    this.state.deliveredAt = new Date();
    this.state.updatedAt = new Date();
  }

  /**
   * Módulo Fiscal llama esto cuando el CAE fue obtenido.
   * Una vez INVOICED, la OV es inmutable a nivel de negocio.
   */
  markInvoiced(): void {
    this.assertTransition('markInvoiced', 'INVOICED');
    this.state.state = 'INVOICED';
    this.state.invoicedAt = new Date();
    this.state.updatedAt = new Date();
  }

  /**
   * Cancela la OV. El use case se encarga de liberar las reservas de stock
   * ANTES de llamar a este método (cancelar los stock moves asociados).
   */
  cancel(reason: string): void {
    this.assertTransition('cancel', 'CANCELLED');

    if (reason.trim().length === 0) {
      throw new ValidationError('Cancel reason cannot be empty');
    }

    if (this.state.state === 'INVOICED') {
      throw new BusinessRuleError(
        'SO_ALREADY_INVOICED',
        'Cannot cancel an invoiced order — use a credit note (NC) instead',
        { orderId: this.state.id, state: this.state.state },
      );
    }

    this.state.state = 'CANCELLED';
    this.state.cancelReason = reason.trim();
    this.state.cancelledAt = new Date();
    this.state.updatedAt = new Date();
  }

  // ---- Helpers internos ----

  /**
   * Recalcula totales de la OV sumando los totales de líneas.
   * Es la fuente de verdad a nivel app; el trigger de DB es un safety net.
   */
  private recalcTotals(): void {
    let subtotal = new Decimal(0);
    let taxAmount = new Decimal(0);
    let total = new Decimal(0);

    for (const line of this.state.lines) {
      subtotal = subtotal.plus(line.subtotalArs);
      taxAmount = taxAmount.plus(line.taxAmountArs);
      total = total.plus(line.totalArs);
    }

    this.state.subtotalArs = subtotal.toFixed(2);
    this.state.taxAmountArs = taxAmount.toFixed(2);
    this.state.totalArs = total.toFixed(2);
  }

  /**
   * Verifica que la transición esté permitida por la state machine.
   * Acepta uno o más estados de destino válidos (para casos como PARTIAL|DELIVERED).
   */
  private assertTransition(action: string, ...targetStates: SalesOrderState[]): void {
    const allowed = VALID_TRANSITIONS[this.state.state];
    const anyValid = targetStates.some((t) => allowed.includes(t));
    if (!anyValid) {
      throw new IllegalStateTransitionError(
        'SalesOrder',
        this.state.state,
        action,
      );
    }
  }
}


