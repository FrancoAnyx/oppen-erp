import { Decimal } from 'decimal.js';
import { ValidationError, BusinessRuleError } from '@erp/shared';

/**
 * Immutable value object que representa UNA línea de una OV.
 *
 * Responsabilidades:
 *   - Calcular subtotal, IVA y total con precisión exacta (Decimal.js)
 *   - Validar invariantes: cantidad > 0, precio >= 0, descuento 0-100
 *   - Registrar cuánto fue entregado/facturado (para parciales)
 *
 * NO es un aggregate root — no tiene version ni repositorio propio.
 * Vive dentro del aggregate SalesOrder.
 */

export interface SalesOrderLineProps {
  id: string;
  tenantId: string;
  orderId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string;         // Decimal(18,4) como string
  uom: string;
  unitPriceArs: string;     // Decimal(18,2) como string
  discountPct: string;      // 0.00 a 100.00
  ivaRate: string;          // Snapshot: 0.00, 10.50, 21.00, 27.00
  quantityDelivered: string;
  quantityInvoiced: string;
  requiresBackorder: boolean;
  reserveMoveId?: string;
  // Calculados — se derivan de los de arriba pero los persistimos
  subtotalArs: string;
  taxAmountArs: string;
  totalArs: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSalesOrderLineProps {
  tenantId: string;
  orderId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string | number;
  uom?: string;
  unitPriceArs: string | number;
  discountPct?: string | number;
  ivaRate: string | number;
}

/** Totales calculados para una línea — result type para CalcResult */
export interface LineAmounts {
  subtotalArs: string;  // unitPrice * qty * (1 - discount/100), sin IVA
  taxAmountArs: string; // subtotal * ivaRate / 100
  totalArs: string;     // subtotal + taxAmount
}

const VALID_IVA_RATES = new Set(['0.00', '10.50', '21.00', '27.00']);

export class SalesOrderLine {
  private constructor(private readonly props: SalesOrderLineProps) {}

  // ---- Factory ----

  static create(p: CreateSalesOrderLineProps): SalesOrderLine {
    const qty = new Decimal(String(p.quantity));
    if (!qty.isFinite() || qty.lte(0)) {
      throw new ValidationError('Line quantity must be greater than zero', {
        quantity: p.quantity,
        lineNumber: p.lineNumber,
      });
    }
    if (qty.decimalPlaces() > 4) {
      throw new ValidationError('Quantity supports at most 4 decimal places', {
        quantity: p.quantity,
      });
    }

    const price = new Decimal(String(p.unitPriceArs));
    if (!price.isFinite() || price.lt(0)) {
      throw new ValidationError('Unit price must be >= 0', {
        unitPriceArs: p.unitPriceArs,
      });
    }

    const discount = new Decimal(String(p.discountPct ?? '0'));
    if (discount.lt(0) || discount.gt(100)) {
      throw new ValidationError('Discount must be between 0 and 100', {
        discountPct: p.discountPct,
      });
    }

    const ivaRateStr = new Decimal(String(p.ivaRate)).toFixed(2);
    if (!VALID_IVA_RATES.has(ivaRateStr)) {
      throw new ValidationError(
        `IVA rate ${ivaRateStr} is not a valid ARCA rate (0.00/10.50/21.00/27.00)`,
        { ivaRate: p.ivaRate },
      );
    }

    const amounts = SalesOrderLine.calcAmounts(qty, price, discount, new Decimal(ivaRateStr));

    const now = new Date();
    return new SalesOrderLine({
      id: '',
      tenantId: p.tenantId,
      orderId: p.orderId,
      productId: p.productId,
      lineNumber: p.lineNumber,
      description: p.description,
      quantity: qty.toFixed(4),
      uom: p.uom ?? 'UN',
      unitPriceArs: price.toFixed(2),
      discountPct: discount.toFixed(2),
      ivaRate: ivaRateStr,
      quantityDelivered: '0.0000',
      quantityInvoiced: '0.0000',
      requiresBackorder: false,
      reserveMoveId: undefined,
      ...amounts,
      createdAt: now,
      updatedAt: now,
    });
  }

  static hydrate(props: SalesOrderLineProps): SalesOrderLine {
    return new SalesOrderLine(props);
  }

  // ---- Getters ----

  get id(): string { return this.props.id; }
  get orderId(): string { return this.props.orderId; }
  get tenantId(): string { return this.props.tenantId; }
  get productId(): string { return this.props.productId; }
  get lineNumber(): number { return this.props.lineNumber; }
  get quantity(): string { return this.props.quantity; }
  get quantityDecimal(): Decimal { return new Decimal(this.props.quantity); }
  get unitPriceArs(): string { return this.props.unitPriceArs; }
  get discountPct(): string { return this.props.discountPct; }
  get ivaRate(): string { return this.props.ivaRate; }
  get subtotalArs(): string { return this.props.subtotalArs; }
  get taxAmountArs(): string { return this.props.taxAmountArs; }
  get totalArs(): string { return this.props.totalArs; }
  get quantityDelivered(): string { return this.props.quantityDelivered; }
  get quantityInvoiced(): string { return this.props.quantityInvoiced; }
  get requiresBackorder(): boolean { return this.props.requiresBackorder; }
  get reserveMoveId(): string | undefined { return this.props.reserveMoveId; }
  get description(): string | undefined { return this.props.description; }
  get uom(): string { return this.props.uom; }

  /**
   * Cantidad pendiente de entrega
   */
  get quantityPendingDelivery(): Decimal {
    return new Decimal(this.props.quantity).minus(this.props.quantityDelivered);
  }

  /**
   * Cantidad pendiente de facturar
   */
  get quantityPendingInvoice(): Decimal {
    return new Decimal(this.props.quantityDelivered).minus(this.props.quantityInvoiced);
  }

  // ---- Mutaciones (devuelven nueva instancia — inmutabilidad) ----

  /**
   * Marca esta línea como que requiere backorder (no había stock suficiente).
   * Llamado por ConfirmSalesOrderUseCase cuando la reserva falla por stock.
   */
  withBackorder(): SalesOrderLine {
    return new SalesOrderLine({
      ...this.props,
      requiresBackorder: true,
      updatedAt: new Date(),
    });
  }

  /**
   * Registra el move de reserva asociado a esta línea.
   */
  withReserveMove(moveId: string): SalesOrderLine {
    return new SalesOrderLine({
      ...this.props,
      reserveMoveId: moveId,
      updatedAt: new Date(),
    });
  }

  /**
   * Registra una entrega parcial o total.
   * quantityToDeliver debe ser <= quantity - quantityDelivered.
   */
  withDelivery(quantityToDeliver: Decimal): SalesOrderLine {
    const newDelivered = new Decimal(this.props.quantityDelivered).plus(quantityToDeliver);
    const total = new Decimal(this.props.quantity);

    if (newDelivered.gt(total)) {
      throw new BusinessRuleError(
        'SO_LINE_OVER_DELIVERY',
        `Cannot deliver ${quantityToDeliver.toFixed(4)} — only ${this.quantityPendingDelivery.toFixed(4)} pending`,
        {
          lineId: this.props.id,
          quantityDelivered: this.props.quantityDelivered,
          attemptedDelivery: quantityToDeliver.toFixed(4),
          totalQuantity: this.props.quantity,
        },
      );
    }

    return new SalesOrderLine({
      ...this.props,
      quantityDelivered: newDelivered.toFixed(4),
      updatedAt: new Date(),
    });
  }

  toProps(): Readonly<SalesOrderLineProps> {
    return { ...this.props };
  }

  // ---- Cálculo puro — testeable sin instanciar ----

  static calcAmounts(
    qty: Decimal,
    unitPrice: Decimal,
    discountPct: Decimal,
    ivaRate: Decimal,
  ): LineAmounts {
    // subtotal = price * qty * (1 - discount/100)
    const subtotal = unitPrice
      .times(qty)
      .times(new Decimal(1).minus(discountPct.div(100)))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    // taxAmount = subtotal * ivaRate / 100
    const taxAmount = subtotal
      .times(ivaRate)
      .div(100)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    const total = subtotal.plus(taxAmount);

    return {
      subtotalArs: subtotal.toFixed(2),
      taxAmountArs: taxAmount.toFixed(2),
      totalArs: total.toFixed(2),
    };
  }
}

