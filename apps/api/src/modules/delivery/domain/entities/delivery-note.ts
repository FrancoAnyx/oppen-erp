// =============================================================================
// apps/api/src/modules/delivery/domain/entities/delivery-note.ts
// =============================================================================

import { Decimal } from 'decimal.js';
import {
  BusinessRuleError,
  ValidationError,
  IllegalStateTransitionError,
} from '@erp/shared';

// =============================================================================
// Tipos y state machine
// =============================================================================

export type DeliveryNoteState =
  | 'DRAFT'
  | 'VALIDATED'
  | 'SHIPPED'
  | 'DONE'
  | 'CANCELLED';

/**
 * Transiciones válidas.
 *
 * DRAFT      → VALIDATED | CANCELLED
 * VALIDATED  → SHIPPED   | CANCELLED
 * SHIPPED    → DONE      (no cancelable — crear move inverso en su lugar)
 * DONE       → (terminal)
 * CANCELLED  → (terminal)
 */
const VALID_TRANSITIONS: Record<
  DeliveryNoteState,
  ReadonlyArray<DeliveryNoteState>
> = {
  DRAFT:     ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['SHIPPED', 'CANCELLED'],
  SHIPPED:   ['DONE'],
  DONE:      [],
  CANCELLED: [],
};

// =============================================================================
// Value object — DeliveryNoteLine
// =============================================================================

export interface DeliveryNoteLineProps {
  id: string;
  tenantId: string;
  deliveryNoteId: string;
  salesOrderLineId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string;        // Decimal(18,4)
  uom: string;
  unitPriceArs: string;    // Decimal(18,2) — snapshot de la OV
  stockMoveId?: string;    // Seteado al hacer SHIPPED
  serialNumbers: string[]; // S/N entregados (solo SERIAL tracking)
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeliveryNoteLineProps {
  tenantId: string;
  salesOrderLineId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string | number;
  uom?: string;
  unitPriceArs: string | number;
  serialNumbers?: string[];
}

export class DeliveryNoteLine {
  private constructor(private readonly props: DeliveryNoteLineProps) {}

  static create(p: CreateDeliveryNoteLineProps): DeliveryNoteLine {
    const qty = new Decimal(String(p.quantity));
    if (!qty.isFinite() || qty.lte(0)) {
      throw new ValidationError('Delivery line quantity must be > 0', {
        quantity: p.quantity,
      });
    }

    const price = new Decimal(String(p.unitPriceArs));
    if (!price.isFinite() || price.lt(0)) {
      throw new ValidationError('Unit price must be >= 0', {
        unitPriceArs: p.unitPriceArs,
      });
    }

    const now = new Date();
    return new DeliveryNoteLine({
      id: '',
      tenantId: p.tenantId,
      deliveryNoteId: '',
      salesOrderLineId: p.salesOrderLineId,
      productId: p.productId,
      lineNumber: p.lineNumber,
      description: p.description,
      quantity: qty.toFixed(4),
      uom: p.uom ?? 'UN',
      unitPriceArs: price.toFixed(2),
      stockMoveId: undefined,
      serialNumbers: p.serialNumbers ?? [],
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: DeliveryNoteLineProps): DeliveryNoteLine {
    return new DeliveryNoteLine(props);
  }

  // ---- Getters ----
  get id(): string                { return this.props.id; }
  get salesOrderLineId(): string  { return this.props.salesOrderLineId; }
  get productId(): string         { return this.props.productId; }
  get lineNumber(): number        { return this.props.lineNumber; }
  get quantity(): Decimal         { return new Decimal(this.props.quantity); }
  get uom(): string               { return this.props.uom; }
  get unitPriceArs(): string      { return this.props.unitPriceArs; }
  get stockMoveId(): string | undefined { return this.props.stockMoveId; }
  get serialNumbers(): string[]   { return this.props.serialNumbers; }
  get description(): string | undefined { return this.props.description; }

  toProps(): Readonly<DeliveryNoteLineProps> {
    return { ...this.props };
  }

  /**
   * Registra el stock move creado al despachar (SHIPPED).
   * Inmutable desde este punto.
   */
  withStockMove(moveId: string): DeliveryNoteLine {
    return new DeliveryNoteLine({
      ...this.props,
      stockMoveId: moveId,
      updatedAt: new Date(),
    });
  }

  /**
   * Asigna números de serie a la línea (para productos SERIAL).
   */
  withSerialNumbers(serials: string[]): DeliveryNoteLine {
    if (serials.length !== this.quantity.toNumber()) {
      throw new BusinessRuleError(
        'DELIVERY_SERIAL_COUNT_MISMATCH',
        'Serial number count must match delivery quantity',
        {
          expected: this.quantity.toNumber(),
          got: serials.length,
          productId: this.props.productId,
        },
      );
    }
    return new DeliveryNoteLine({
      ...this.props,
      serialNumbers: serials,
      updatedAt: new Date(),
    });
  }
}

// =============================================================================
// Aggregate root — DeliveryNote
// =============================================================================

export interface DeliveryNoteProps {
  id: string;
  tenantId: string;
  deliveryNumber: number;
  salesOrderId: string;
  recipientId: string;
  recipientName: string;
  recipientCuit: string;
  recipientAddress?: string;
  state: DeliveryNoteState;
  scheduledDate?: Date;
  shippedDate?: Date;
  doneDate?: Date;
  carrierId?: string;
  trackingCode?: string;
  notes?: string;
  internalNotes?: string;
  lockedAt?: Date;
  pdfPath?: string;
  version: number;
  createdById: string;
  validatedById?: string;
  shippedById?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
  lines: DeliveryNoteLine[];
}

export interface CreateDeliveryNoteProps {
  tenantId: string;
  deliveryNumber: number;
  salesOrderId: string;
  recipientId: string;
  recipientName: string;
  recipientCuit: string;
  recipientAddress?: string;
  scheduledDate?: Date;
  carrierId?: string;
  notes?: string;
  createdById: string;
  lines: Omit<CreateDeliveryNoteLineProps, 'tenantId'>[];
}

export class DeliveryNote {
  private constructor(private state: DeliveryNoteProps) {}

  // ---- Factories ----

  static create(props: CreateDeliveryNoteProps): DeliveryNote {
    if (props.lines.length === 0) {
      throw new BusinessRuleError(
        'DN_NO_LINES',
        'A delivery note must have at least one line',
        { salesOrderId: props.salesOrderId },
      );
    }

    const lines = props.lines.map((l, idx) =>
      DeliveryNoteLine.create({
        ...l,
        tenantId: props.tenantId,
        lineNumber: idx + 1,
      }),
    );

    const now = new Date();
    return new DeliveryNote({
      id: '',
      tenantId: props.tenantId,
      deliveryNumber: props.deliveryNumber,
      salesOrderId: props.salesOrderId,
      recipientId: props.recipientId,
      recipientName: props.recipientName,
      recipientCuit: props.recipientCuit,
      recipientAddress: props.recipientAddress,
      state: 'DRAFT',
      scheduledDate: props.scheduledDate,
      carrierId: props.carrierId,
      notes: props.notes,
      version: 1,
      createdById: props.createdById,
      createdAt: now,
      updatedAt: now,
      lines,
    });
  }

  static hydrate(props: DeliveryNoteProps): DeliveryNote {
    return new DeliveryNote(props);
  }

  // ---- Getters ----
  get id(): string                { return this.state.id; }
  get tenantId(): string          { return this.state.tenantId; }
  get salesOrderId(): string      { return this.state.salesOrderId; }
  get deliveryNumber(): number    { return this.state.deliveryNumber; }
  get currentState(): DeliveryNoteState { return this.state.state; }
  get version(): number           { return this.state.version; }
  get lines(): ReadonlyArray<DeliveryNoteLine> { return this.state.lines; }
  get isLocked(): boolean         { return !!this.state.lockedAt; }
  get recipientId(): string       { return this.state.recipientId; }

  toProps(): Readonly<DeliveryNoteProps> {
    return { ...this.state, lines: [...this.state.lines] };
  }

  // ---- State machine transitions ----

  /**
   * DRAFT → VALIDATED.
   * El supervisor revisa el remito antes del despacho.
   * En VALIDATED, los stock moves pasan a ASSIGNED (se reservan series si aplica).
   */
  validate(validatedById: string): void {
    this.assertTransition('validate', 'VALIDATED');
    this.state.state = 'VALIDATED';
    this.state.validatedById = validatedById;
    this.state.updatedAt = new Date();
  }

  /**
   * VALIDATED → SHIPPED.
   * La mercadería salió físicamente del depósito.
   * El use case debe:
   *   1. Llamar a este método
   *   2. Marcar cada stockMove de las líneas como DONE (INTERNAL → CUSTOMER)
   *   3. Actualizar quantityDelivered en las líneas de la OV
   *   4. Actualizar el estado de la OV (PARTIAL o DELIVERED)
   *
   * Una vez SHIPPED el documento es INMUTABLE — lockedAt se setea aquí.
   */
  ship(
    shippedById: string,
    lineMovePairs: Array<{ lineId: string; moveId: string }>,
    shippedDate?: Date,
  ): void {
    this.assertTransition('ship', 'SHIPPED');

    // Actualizar stockMoveId en cada línea
    const updatedLines = this.state.lines.map((line) => {
      const pair = lineMovePairs.find((p) => p.lineId === line.id);
      if (pair) {
        return line.withStockMove(pair.moveId);
      }
      return line;
    });

    const now = new Date();
    this.state.lines = updatedLines;
    this.state.state = 'SHIPPED';
    this.state.shippedById = shippedById;
    this.state.shippedDate = shippedDate ?? now;
    this.state.lockedAt = now;  // INMUTABLE desde acá
    this.state.updatedAt = now;
  }

  /**
   * SHIPPED → DONE.
   * El cliente confirmó la recepción.
   * Este estado habilita la emisión de factura electrónica en módulo Fiscal.
   */
  markDone(): void {
    this.assertTransition('markDone', 'DONE');
    const now = new Date();
    this.state.state = 'DONE';
    this.state.doneDate = now;
    this.state.updatedAt = now;
  }

  /**
   * DRAFT | VALIDATED → CANCELLED.
   * No se puede cancelar desde SHIPPED (requiere proceso de devolución RMA).
   */
  cancel(reason: string, cancelledById: string): void {
    this.assertTransition('cancel', 'CANCELLED');

    if (!reason.trim()) {
      throw new ValidationError('Cancel reason cannot be empty');
    }

    if (this.state.state === 'SHIPPED' || this.state.state === 'DONE') {
      throw new BusinessRuleError(
        'DN_CANNOT_CANCEL_SHIPPED',
        'Cannot cancel a shipped delivery note — create an RMA instead',
        { deliveryNoteId: this.state.id, state: this.state.state },
      );
    }

    this.state.state = 'CANCELLED';
    this.state.cancelReason = reason.trim();
    this.state.cancelledAt = new Date();
    this.state.updatedAt = new Date();
  }

  /**
   * Actualiza el path del PDF generado.
   * Puede actualizarse en cualquier estado (regenerar PDF).
   */
  setPdfPath(path: string): void {
    this.state.pdfPath = path;
    this.state.updatedAt = new Date();
  }

  /**
   * Retorna el total de unidades en el remito (sum de líneas).
   */
  get totalQuantity(): Decimal {
    return this.state.lines.reduce(
      (acc, l) => acc.plus(l.quantity),
      new Decimal(0),
    );
  }

  // ---- Guard de inmutabilidad ----

  assertMutable(): void {
    if (this.state.lockedAt) {
      throw new BusinessRuleError(
        'DN_IMMUTABLE',
        'This delivery note is locked and cannot be modified',
        {
          deliveryNoteId: this.state.id,
          lockedAt: this.state.lockedAt,
          state: this.state.state,
        },
      );
    }
  }

  // ---- Helper interno ----

  private assertTransition(
    method: string,
    ...targets: DeliveryNoteState[]
  ): void {
    const allowed = VALID_TRANSITIONS[this.state.state];
    const isValid = targets.some((t) => allowed.includes(t));
    if (!isValid) {
      throw new IllegalStateTransitionError(
        'DeliveryNote',
        this.state.state,
        method,
      );
    }
  }
}
