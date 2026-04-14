// =============================================================================
// apps/api/src/modules/fiscal/domain/entities/invoice.ts
// =============================================================================

import { Decimal } from 'decimal.js';
import {
  BusinessRuleError,
  ValidationError,
  IllegalStateTransitionError,
} from '@erp/shared';
import { AFIP_DOC_CODES } from '@erp/shared';

// =============================================================================
// Tipos
// =============================================================================

export type InvoiceState =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'APPROVED'
  | 'FAILED'
  | 'VOIDED';

export type DocTypeCode =
  | 1   // Factura A
  | 2   // Nota Débito A
  | 3   // Nota Crédito A
  | 6   // Factura B
  | 7   // Nota Débito B
  | 8   // Nota Crédito B
  | 11  // Factura C
  | 12  // Nota Débito C
  | 13; // Nota Crédito C

const DOC_TYPE_LABELS: Record<number, string> = {
  1: 'FACTURA A', 2: 'NOTA DE DÉBITO A', 3: 'NOTA DE CRÉDITO A',
  6: 'FACTURA B', 7: 'NOTA DE DÉBITO B', 8: 'NOTA DE CRÉDITO B',
  11: 'FACTURA C', 12: 'NOTA DE DÉBITO C', 13: 'NOTA DE CRÉDITO C',
};

const VALID_TRANSITIONS: Record<InvoiceState, ReadonlyArray<InvoiceState>> = {
  PENDING:    ['QUEUED', 'FAILED'],
  QUEUED:     ['PROCESSING', 'FAILED'],
  PROCESSING: ['APPROVED', 'FAILED'],
  APPROVED:   ['VOIDED'],
  FAILED:     ['QUEUED'],  // permite reencolar manualmente
  VOIDED:     [],
};

// =============================================================================
// IVA breakdown — cálculo conforme WSFE FECAESolicitar
// =============================================================================

export interface IvaAliquot {
  /** Código ARCA: 5=21%, 4=10.5%, 6=27%, 3=0%, 2=EXENTO */
  arcaCode: number;
  rate: string;       // "21.00", "10.50", "0.00"
  baseImponible: string;
  ivaAmount: string;
}

/** Mapeo rate% → código ARCA para el campo Iva[] de FECAESolicitar */
const RATE_TO_ARCA_CODE: Record<string, number> = {
  '21.00': 5,
  '10.50': 4,
  '27.00': 6,
  '0.00':  3,
};

// =============================================================================
// InvoiceLine (value object inmutable)
// =============================================================================

export interface InvoiceLineProps {
  id: string;
  tenantId: string;
  invoiceId: string;
  lineNumber: number;
  description: string;
  quantity: string;
  uom: string;
  unitPriceArs: string;
  discountPct: string;
  ivaRate: string;
  subtotalArs: string;
  ivaArs: string;
  totalArs: string;
  salesOrderLineId?: string;
  createdAt: Date;
}

export interface CreateInvoiceLineProps {
  tenantId: string;
  lineNumber: number;
  description: string;
  quantity: string | number;
  uom?: string;
  unitPriceArs: string | number;
  discountPct?: string | number;
  ivaRate: string | number;
  salesOrderLineId?: string;
}

export class InvoiceLine {
  private constructor(private readonly props: InvoiceLineProps) {}

  static create(p: CreateInvoiceLineProps): InvoiceLine {
    const qty      = new Decimal(String(p.quantity));
    const price    = new Decimal(String(p.unitPriceArs));
    const disc     = new Decimal(String(p.discountPct ?? '0'));
    const ivaRate  = new Decimal(String(p.ivaRate));

    if (qty.lte(0))   throw new ValidationError('Invoice line quantity must be > 0');
    if (price.lt(0))  throw new ValidationError('Unit price must be >= 0');
    if (disc.lt(0) || disc.gt(100)) throw new ValidationError('Discount must be 0-100');

    // subtotal = qty × price × (1 - disc/100)
    const subtotal = qty.times(price)
      .times(new Decimal(1).minus(disc.div(100)))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    const ivaArs = subtotal.times(ivaRate).div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    const total = subtotal.plus(ivaArs);

    return new InvoiceLine({
      id: '',
      tenantId: p.tenantId,
      invoiceId: '',
      lineNumber: p.lineNumber,
      description: p.description,
      quantity: qty.toFixed(4),
      uom: p.uom ?? 'UN',
      unitPriceArs: price.toFixed(2),
      discountPct: disc.toFixed(2),
      ivaRate: ivaRate.toFixed(2),
      subtotalArs: subtotal.toFixed(2),
      ivaArs: ivaArs.toFixed(2),
      totalArs: total.toFixed(2),
      salesOrderLineId: p.salesOrderLineId,
      createdAt: new Date(),
    });
  }

  static hydrate(props: InvoiceLineProps): InvoiceLine {
    return new InvoiceLine(props);
  }

  get id(): string              { return this.props.id; }
  get lineNumber(): number      { return this.props.lineNumber; }
  get ivaRate(): Decimal        { return new Decimal(this.props.ivaRate); }
  get subtotalArs(): Decimal    { return new Decimal(this.props.subtotalArs); }
  get ivaArs(): Decimal         { return new Decimal(this.props.ivaArs); }
  get totalArs(): Decimal       { return new Decimal(this.props.totalArs); }
  get description(): string     { return this.props.description; }
  get salesOrderLineId(): string | undefined { return this.props.salesOrderLineId; }

  toProps(): Readonly<InvoiceLineProps> { return { ...this.props }; }
}

// =============================================================================
// Invoice — aggregate root
// =============================================================================

export interface InvoiceProps {
  id: string;
  tenantId: string;
  salesOrderId: string;
  posNumberId: string;
  posNumber: number;
  docTypeCode: number;
  docTypeDesc: string;
  docNumber?: number;
  recipientCuit: string;
  recipientName: string;
  recipientIva: string;
  invoiceDate: Date;
  subtotalArs: string;
  ivaBreakdown: IvaAliquot[];
  totalIvaArs: string;
  totalArs: string;
  state: InvoiceState;
  cae?: string;
  caeExpiresAt?: Date;
  isContingency: boolean;
  caea?: string;
  originalInvoiceId?: string;
  bullJobId?: string;
  arcaAttempts: number;
  lastArcaError?: string;
  pdfPath?: string;
  version: number;
  createdById: string;
  approvedAt?: Date;
  failedAt?: Date;
  voidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  lines: InvoiceLine[];
}

export interface CreateInvoiceProps {
  tenantId: string;
  salesOrderId: string;
  posNumberId: string;
  posNumber: number;
  docTypeCode: number;
  recipientCuit: string;
  recipientName: string;
  recipientIva: string;
  invoiceDate: Date;
  createdById: string;
  originalInvoiceId?: string;
  lines: Omit<CreateInvoiceLineProps, 'tenantId' | 'lineNumber'>[];
}

export class Invoice {
  private constructor(private state: InvoiceProps) {}

  // ---- Factories ----

  static create(props: CreateInvoiceProps): Invoice {
    if (!props.lines.length) {
      throw new BusinessRuleError('INV_NO_LINES', 'Invoice must have at least one line');
    }

    const docTypeDesc = DOC_TYPE_LABELS[props.docTypeCode];
    if (!docTypeDesc) {
      throw new ValidationError(`Unknown docTypeCode: ${props.docTypeCode}`);
    }

    const lines = props.lines.map((l, idx) =>
      InvoiceLine.create({ ...l, tenantId: props.tenantId, lineNumber: idx + 1 }),
    );

    const { subtotal, totalIva, total, breakdown } = Invoice.calcTotals(lines);

    const now = new Date();
    return new Invoice({
      id: '',
      tenantId: props.tenantId,
      salesOrderId: props.salesOrderId,
      posNumberId: props.posNumberId,
      posNumber: props.posNumber,
      docTypeCode: props.docTypeCode,
      docTypeDesc,
      recipientCuit: props.recipientCuit,
      recipientName: props.recipientName,
      recipientIva: props.recipientIva,
      invoiceDate: props.invoiceDate,
      subtotalArs: subtotal,
      ivaBreakdown: breakdown,
      totalIvaArs: totalIva,
      totalArs: total,
      state: 'PENDING',
      isContingency: false,
      arcaAttempts: 0,
      version: 1,
      createdById: props.createdById,
      originalInvoiceId: props.originalInvoiceId,
      createdAt: now,
      updatedAt: now,
      lines,
    });
  }

  static hydrate(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  // ---- Getters ----
  get id(): string              { return this.state.id; }
  get tenantId(): string        { return this.state.tenantId; }
  get salesOrderId(): string    { return this.state.salesOrderId; }
  get currentState(): InvoiceState { return this.state.state; }
  get cae(): string | undefined { return this.state.cae; }
  get docTypeCode(): number     { return this.state.docTypeCode; }
  get posNumber(): number       { return this.state.posNumber; }
  get docNumber(): number | undefined { return this.state.docNumber; }
  get version(): number         { return this.state.version; }
  get isContingency(): boolean  { return this.state.isContingency; }
  get arcaAttempts(): number    { return this.state.arcaAttempts; }
  get lines(): ReadonlyArray<InvoiceLine> { return this.state.lines; }
  get totalArs(): string        { return this.state.totalArs; }
  get ivaBreakdown(): ReadonlyArray<IvaAliquot> { return this.state.ivaBreakdown; }
  get isApproved(): boolean     { return this.state.state === 'APPROVED'; }
  get bullJobId(): string | undefined { return this.state.bullJobId; }

  toProps(): Readonly<InvoiceProps> {
    return { ...this.state, lines: [...this.state.lines] };
  }

  // ---- State transitions ----

  /** PENDING → QUEUED: se encoló en BullMQ */
  markQueued(bullJobId: string): void {
    this.assertTransition('markQueued', 'QUEUED');
    this.state.bullJobId = bullJobId;
    this.state.state = 'QUEUED';
    this.state.updatedAt = new Date();
  }

  /** QUEUED → PROCESSING: el worker tomó el job */
  markProcessing(): void {
    this.assertTransition('markProcessing', 'PROCESSING');
    this.state.state = 'PROCESSING';
    this.state.arcaAttempts += 1;
    this.state.updatedAt = new Date();
  }

  /**
   * PROCESSING → APPROVED.
   * Registra el CAE y el número de comprobante asignado por ARCA.
   * Desde este momento el documento es INMUTABLE.
   */
  approve(params: {
    cae: string;
    caeExpiresAt: Date;
    docNumber: number;
    isContingency?: boolean;
    caea?: string;
  }): void {
    this.assertTransition('approve', 'APPROVED');

    if (!params.cae || params.cae.length !== 14) {
      throw new ValidationError('CAE must be exactly 14 digits', { cae: params.cae });
    }

    this.state.cae = params.cae;
    this.state.caeExpiresAt = params.caeExpiresAt;
    this.state.docNumber = params.docNumber;
    this.state.isContingency = params.isContingency ?? false;
    this.state.caea = params.caea;
    this.state.state = 'APPROVED';
    this.state.lastArcaError = undefined;
    this.state.approvedAt = new Date();
    this.state.updatedAt = new Date();
  }

  /**
   * → FAILED.
   * Registra el error. Puede volver a QUEUED para reintento manual.
   */
  markFailed(errorMsg: string): void {
    this.assertTransition('markFailed', 'FAILED');
    this.state.lastArcaError = errorMsg.slice(0, 1000); // truncar
    this.state.state = 'FAILED';
    this.state.failedAt = new Date();
    this.state.updatedAt = new Date();
  }

  /** FAILED → QUEUED: reintento manual por operador */
  requeue(bullJobId: string): void {
    this.assertTransition('requeue', 'QUEUED');
    this.state.bullJobId = bullJobId;
    this.state.state = 'QUEUED';
    this.state.lastArcaError = undefined;
    this.state.updatedAt = new Date();
  }

  /**
   * APPROVED → VOIDED.
   * La OV asociada debe tener una NC aprobada.
   * Este método lo llama el UseCase de creación de NC.
   */
  void(): void {
    this.assertTransition('void', 'VOIDED');
    if (this.state.state !== 'APPROVED') {
      throw new BusinessRuleError(
        'INV_MUST_BE_APPROVED_TO_VOID',
        'Only APPROVED invoices can be voided',
        { invoiceId: this.state.id },
      );
    }
    this.state.state = 'VOIDED';
    this.state.voidedAt = new Date();
    this.state.updatedAt = new Date();
  }

  /** Guarda el path del PDF generado */
  setPdfPath(path: string): void {
    this.state.pdfPath = path;
    this.state.updatedAt = new Date();
  }

  // ---- Helpers de dominio ----

  /**
   * Construye el array Iva[] para FECAESolicitar.
   * ARCA requiere agrupar importes por alícuota.
   */
  buildArcaIvaArray(): Array<{
    Id: number;
    BaseImp: number;
    Importe: number;
  }> {
    return this.state.ivaBreakdown
      .filter((a) => new Decimal(a.ivaAmount).gt(0))
      .map((a) => ({
        Id: a.arcaCode,
        BaseImp: parseFloat(a.baseImponible),
        Importe: parseFloat(a.ivaAmount),
      }));
  }

  /**
   * Determina el tipo de comprobante según condición IVA del receptor.
   * Regla:
   *   - Receptor RI  → Factura A (1)
   *   - Receptor CF/MONO/EXENTO/NO_RESP → Factura B (6)
   *   - Emisor MONO  → Factura C (11) para cualquier receptor
   */
  static resolveDocType(
    emisorIva: string,
    receptorIva: string,
  ): { code: number; desc: string } {
    if (emisorIva === 'MONOTRIBUTO') {
      return { code: 11, desc: 'FACTURA C' };
    }
    if (receptorIva === 'RI') {
      return { code: 1, desc: 'FACTURA A' };
    }
    return { code: 6, desc: 'FACTURA B' };
  }

  // ---- Cálculo de totales (estático para uso en tests también) ----

  static calcTotals(lines: InvoiceLine[]): {
    subtotal: string;
    totalIva: string;
    total: string;
    breakdown: IvaAliquot[];
  } {
    // Acumular por alícuota
    const byRate = new Map<string, { base: Decimal; iva: Decimal }>();

    let subtotal = new Decimal(0);
    let totalIva = new Decimal(0);

    for (const line of lines) {
      subtotal = subtotal.plus(line.subtotalArs);
      totalIva = totalIva.plus(line.ivaArs);

      const rateKey = line.ivaRate.toFixed(2);
      const existing = byRate.get(rateKey) ?? { base: new Decimal(0), iva: new Decimal(0) };
      byRate.set(rateKey, {
        base: existing.base.plus(line.subtotalArs),
        iva: existing.iva.plus(line.ivaArs),
      });
    }

    const breakdown: IvaAliquot[] = [];
    for (const [rate, amounts] of byRate.entries()) {
      const arcaCode = RATE_TO_ARCA_CODE[rate];
      if (arcaCode === undefined) {
        throw new BusinessRuleError(
          'INV_UNKNOWN_IVA_RATE',
          `IVA rate ${rate}% has no ARCA code mapping`,
          { rate },
        );
      }
      breakdown.push({
        arcaCode,
        rate,
        baseImponible: amounts.base.toFixed(2),
        ivaAmount: amounts.iva.toFixed(2),
      });
    }

    const total = subtotal.plus(totalIva);

    return {
      subtotal: subtotal.toFixed(2),
      totalIva: totalIva.toFixed(2),
      total: total.toFixed(2),
      breakdown,
    };
  }

  // ---- Guard ----

  assertImmutable(): void {
    if (this.state.state === 'APPROVED' || this.state.state === 'VOIDED') {
      throw new BusinessRuleError(
        'INV_IMMUTABLE',
        'This invoice is locked and cannot be modified. Use a credit note to correct it.',
        { invoiceId: this.state.id, state: this.state.state, cae: this.state.cae },
      );
    }
  }

  private assertTransition(method: string, ...targets: InvoiceState[]): void {
    const allowed = VALID_TRANSITIONS[this.state.state];
    if (!targets.some((t) => allowed.includes(t))) {
      throw new IllegalStateTransitionError('Invoice', this.state.state, method);
    }
  }
}
