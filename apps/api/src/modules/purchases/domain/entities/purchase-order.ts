import { Decimal } from 'decimal.js';
import {
  BusinessRuleError,
  ValidationError,
  IllegalStateTransitionError,
} from '@erp/shared';

// =============================================================================
// Tipos
// =============================================================================

export type PurchaseOrderState =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'CANCELLED';

const VALID_TRANSITIONS: Record<PurchaseOrderState, ReadonlyArray<PurchaseOrderState>> = {
  DRAFT:     ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL:   ['RECEIVED', 'CANCELLED'],
  RECEIVED:  [],   // terminal
  CANCELLED: [],   // terminal
};

// =============================================================================
// Line value object
// =============================================================================

export interface PurchaseOrderLineProps {
  id: string;
  tenantId: string;
  orderId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string;          // Decimal(18,4)
  uom: string;
  unitCostUsd: string;       // Decimal(18,4)
  ivaRate: string;           // 0.00 para la mayoría de insumos tech
  quantityReceived: string;
  incomingMoveId?: string;
  soLineOriginId?: string;
  subtotalUsd: string;
  taxAmountUsd: string;
  totalUsd: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePurchaseOrderLineProps {
  tenantId: string;
  orderId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string | number;
  uom?: string;
  unitCostUsd: string | number;
  ivaRate?: string | number;
  soLineOriginId?: string;
}

export class PurchaseOrderLine {
  private constructor(private readonly props: PurchaseOrderLineProps) {}

  static create(p: CreatePurchaseOrderLineProps): PurchaseOrderLine {
    const qty = new Decimal(String(p.quantity));
    if (!qty.isFinite() || qty.lte(0)) {
      throw new ValidationError('Line quantity must be > 0', { quantity: p.quantity });
    }

    const cost = new Decimal(String(p.unitCostUsd));
    if (!cost.isFinite() || cost.lt(0)) {
      throw new ValidationError('Unit cost must be >= 0', { unitCostUsd: p.unitCostUsd });
    }

    const iva = new Decimal(String(p.ivaRate ?? '0'));
    if (iva.lt(0) || iva.gt(100)) {
      throw new ValidationError('IVA rate must be 0-100', { ivaRate: p.ivaRate });
    }

    // subtotal = cost * qty
    const subtotal = cost.times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const taxAmount = subtotal.times(iva).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const total = subtotal.plus(taxAmount);

    const now = new Date();
    return new PurchaseOrderLine({
      id: '',
      tenantId: p.tenantId,
      orderId: p.orderId,
      productId: p.productId,
      lineNumber: p.lineNumber,
      description: p.description,
      quantity: qty.toFixed(4),
      uom: p.uom ?? 'UN',
      unitCostUsd: cost.toFixed(4),
      ivaRate: iva.toFixed(2),
      quantityReceived: '0.0000',
      incomingMoveId: undefined,
      soLineOriginId: p.soLineOriginId,
      subtotalUsd: subtotal.toFixed(2),
      taxAmountUsd: taxAmount.toFixed(2),
      totalUsd: total.toFixed(2),
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: PurchaseOrderLineProps): PurchaseOrderLine {
    return new PurchaseOrderLine(props);
  }

  get id(): string { return this.props.id; }
  get orderId(): string { return this.props.orderId; }
  get tenantId(): string { return this.props.tenantId; }
  get productId(): string { return this.props.productId; }
  get lineNumber(): number { return this.props.lineNumber; }
  get quantity(): string { return this.props.quantity; }
  get quantityDecimal(): Decimal { return new Decimal(this.props.quantity); }
  get quantityReceived(): string { return this.props.quantityReceived; }
  get unitCostUsd(): string { return this.props.unitCostUsd; }
  get ivaRate(): string { return this.props.ivaRate; }
  get subtotalUsd(): string { return this.props.subtotalUsd; }
  get taxAmountUsd(): string { return this.props.taxAmountUsd; }
  get totalUsd(): string { return this.props.totalUsd; }
  get incomingMoveId(): string | undefined { return this.props.incomingMoveId; }
  get soLineOriginId(): string | undefined { return this.props.soLineOriginId; }
  get description(): string | undefined { return this.props.description; }
  get uom(): string { return this.props.uom; }

  get quantityPending(): Decimal {
    return new Decimal(this.props.quantity).minus(this.props.quantityReceived);
  }

  withIncomingMove(moveId: string): PurchaseOrderLine {
    return new PurchaseOrderLine({
      ...this.props,
      incomingMoveId: moveId,
      updatedAt: new Date(),
    });
  }

  withReceipt(qtyReceived: Decimal): PurchaseOrderLine {
    const newReceived = new Decimal(this.props.quantityReceived).plus(qtyReceived);
    if (newReceived.gt(this.props.quantity)) {
      throw new BusinessRuleError(
        'PO_LINE_OVER_RECEIPT',
        `Cannot receive ${qtyReceived.toFixed(4)} — only ${this.quantityPending.toFixed(4)} pending`,
        { lineId: this.props.id },
      );
    }
    return new PurchaseOrderLine({
      ...this.props,
      quantityReceived: newReceived.toFixed(4),
      updatedAt: new Date(),
    });
  }

  toProps(): Readonly<PurchaseOrderLineProps> {
    return { ...this.props };
  }
}

// =============================================================================
// PurchaseOrder aggregate root
// =============================================================================

export interface PurchaseOrderProps {
  id: string;
  tenantId: string;
  orderNumber: number;
  supplierId: string;
  state: PurchaseOrderState;
  currency: string;
  fxRateAtConfirm?: string;
  expectedDate?: Date;
  deliveryAddress?: string;
  notes?: string;
  soOriginId?: string;
  subtotalUsd: string;
  taxAmountUsd: string;
  totalUsd: string;
  subtotalArs: string;
  totalArs: string;
  version: number;
  createdById: string;
  confirmedAt?: Date;
  receivedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
  lines: PurchaseOrderLine[];
}

export interface CreatePurchaseOrderProps {
  tenantId: string;
  supplierId: string;
  orderNumber: number;
  currency?: string;
  expectedDate?: Date;
  deliveryAddress?: string;
  notes?: string;
  soOriginId?: string;
  createdById: string;
  lines: Omit<CreatePurchaseOrderLineProps, 'tenantId' | 'orderId'>[];
}

export class PurchaseOrder {
  private constructor(private state: PurchaseOrderProps) {}

  static create(props: CreatePurchaseOrderProps): PurchaseOrder {
    if (props.lines.length === 0) {
      throw new BusinessRuleError(
        'PO_NO_LINES',
        'A purchase order must have at least one line',
        { supplierId: props.supplierId },
      );
    }

    const lines = props.lines.map((l, idx) =>
      PurchaseOrderLine.create({
        ...l,
        tenantId: props.tenantId,
        orderId: '',
        lineNumber: idx + 1,
      }),
    );

    const now = new Date();
    const po = new PurchaseOrder({
      id: '',
      tenantId: props.tenantId,
      orderNumber: props.orderNumber,
      supplierId: props.supplierId,
      state: 'DRAFT',
      currency: props.currency ?? 'USD',
      expectedDate: props.expectedDate,
      deliveryAddress: props.deliveryAddress,
      notes: props.notes,
      soOriginId: props.soOriginId,
      subtotalUsd: '0.00',
      taxAmountUsd: '0.00',
      totalUsd: '0.00',
      subtotalArs: '0.00',
      totalArs: '0.00',
      version: 1,
      createdById: props.createdById,
      createdAt: now,
      updatedAt: now,
      lines,
    });

    po.recalcTotals();
    return po;
  }

  static hydrate(props: PurchaseOrderProps): PurchaseOrder {
    return new PurchaseOrder(props);
  }

  // ---- Getters ----
  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get orderNumber(): number { return this.state.orderNumber; }
  get supplierId(): string { return this.state.supplierId; }
  get currentState(): PurchaseOrderState { return this.state.state; }
  get version(): number { return this.state.version; }
  get lines(): ReadonlyArray<PurchaseOrderLine> { return this.state.lines; }
  get soOriginId(): string | undefined { return this.state.soOriginId; }
  get subtotalUsd(): string { return this.state.subtotalUsd; }
  get totalUsd(): string { return this.state.totalUsd; }
  get currency(): string { return this.state.currency; }
  get createdById(): string { return this.state.createdById; }
  get notes(): string | undefined { return this.state.notes; }
  get expectedDate(): Date | undefined { return this.state.expectedDate; }

  toState(): Readonly<PurchaseOrderProps> {
    return { ...this.state, lines: [...this.state.lines] };
  }

  // ---- Transiciones ----

  /**
   * CONFIRMED: registra el incomingMoveId por línea (creados por el use case).
   * Estos moves representan el "Incoming" en el stock — mercadería en camino.
   */
  confirm(
    lineMovePairs: Array<{ lineId: string; moveId: string }>,
    fxRate?: string,
  ): void {
    this.assertTransition('confirm', 'CONFIRMED');

    const moveMap = new Map(lineMovePairs.map((p) => [p.lineId, p.moveId]));

    this.state.lines = this.state.lines.map((line) => {
      const moveId = moveMap.get(line.id);
      return moveId ? line.withIncomingMove(moveId) : line;
    });

    this.state.fxRateAtConfirm = fxRate;
    this.state.state = 'CONFIRMED';
    this.state.confirmedAt = new Date();
    this.state.updatedAt = new Date();

    // Recalcular totales ARS si hay TC
    if (fxRate) {
      const fx = new Decimal(fxRate);
      this.state.subtotalArs = new Decimal(this.state.subtotalUsd).times(fx).toFixed(2);
      this.state.totalArs = new Decimal(this.state.totalUsd).times(fx).toFixed(2);
    }
  }

  /**
   * Registra recepción parcial o total por línea.
   * El use case construye receipts desde el remito de entrada.
   */
  receive(receipts: Array<{ lineId: string; quantity: Decimal }>): void {
    this.assertTransition('receive', 'PARTIAL', 'RECEIVED');

    const updatedLines = this.state.lines.map((line) => {
      const receipt = receipts.find((r) => r.lineId === line.id);
      return receipt ? line.withReceipt(receipt.quantity) : line;
    });

    const allReceived = updatedLines.every((l) => l.quantityPending.isZero());

    this.state.lines = updatedLines;
    this.state.state = allReceived ? 'RECEIVED' : 'PARTIAL';
    this.state.updatedAt = new Date();

    if (allReceived) {
      this.state.receivedAt = new Date();
    }
  }

  cancel(reason: string): void {
    this.assertTransition('cancel', 'CANCELLED');
    if (reason.trim().length === 0) {
      throw new ValidationError('Cancel reason cannot be empty');
    }
    this.state.state = 'CANCELLED';
    this.state.cancelReason = reason.trim();
    this.state.cancelledAt = new Date();
    this.state.updatedAt = new Date();
  }

  private recalcTotals(): void {
    let sub = new Decimal(0);
    let tax = new Decimal(0);
    let tot = new Decimal(0);
    for (const l of this.state.lines) {
      sub = sub.plus(l.subtotalUsd);
      tax = tax.plus(l.taxAmountUsd);
      tot = tot.plus(l.totalUsd);
    }
    this.state.subtotalUsd = sub.toFixed(2);
    this.state.taxAmountUsd = tax.toFixed(2);
    this.state.totalUsd = tot.toFixed(2);
  }

  private assertTransition(action: string, ...targets: PurchaseOrderState[]): void {
    const allowed = VALID_TRANSITIONS[this.state.state];
    if (!targets.some((t) => allowed.includes(t))) {
      throw new IllegalStateTransitionError('PurchaseOrder', this.state.state, action);
    }
  }
}

