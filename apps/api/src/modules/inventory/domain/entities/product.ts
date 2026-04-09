import { BusinessRuleError, ValidationError } from '@erp/shared';

export type TrackingType = 'NONE' | 'LOT' | 'SERIAL';
export type CostMethod = 'FIFO' | 'AVG' | 'STD';

export interface ProductState {
  id: string;
  tenantId: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  categoryId?: string;
  tracking: TrackingType;
  ivaRate: string;
  internalTaxRate: string;
  costMethod: CostMethod;
  standardCostUsd?: string;
  listPriceArs?: string;
  weightKg?: string;
  uom: string;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductProps {
  tenantId: string;
  sku: string;
  name: string;
  description?: string;
  barcode?: string;
  categoryId?: string;
  tracking?: TrackingType;
  ivaRate?: string;
  internalTaxRate?: string;
  costMethod?: CostMethod;
  standardCostUsd?: string;
  listPriceArs?: string;
  weightKg?: string;
  uom?: string;
}

const VALID_IVA_RATES = new Set(['0.00', '10.50', '21.00', '27.00']);

/**
 * Product — aggregate root del catálogo de artículos.
 *
 * Invariantes:
 *   - SKU único por tenant (chequeado en repositorio)
 *   - ivaRate debe ser uno de los valores de ARCA (0/10.5/21/27)
 *   - tracking no puede cambiar si ya hay movimientos de stock
 *     (esto se chequea en el application service, no acá)
 *   - listPriceArs >= 0 si está presente
 */
export class Product {
  private constructor(private state: ProductState) {}

  static create(props: CreateProductProps): Product {
    if (props.sku.trim().length === 0) {
      throw new ValidationError('SKU cannot be empty');
    }
    if (!/^[A-Za-z0-9\-_.]+$/.test(props.sku)) {
      throw new ValidationError(
        'SKU can only contain alphanumeric, dash, underscore, dot',
        { sku: props.sku },
      );
    }
    if (props.name.trim().length === 0) {
      throw new ValidationError('Product name cannot be empty');
    }

    const ivaRate = props.ivaRate ?? '21.00';
    if (!VALID_IVA_RATES.has(ivaRate)) {
      throw new ValidationError(`Invalid IVA rate: ${ivaRate}`, { ivaRate });
    }

    if (props.listPriceArs !== undefined) {
      const n = Number(props.listPriceArs);
      if (Number.isNaN(n) || n < 0) {
        throw new ValidationError('listPriceArs must be >= 0');
      }
    }

    return new Product({
      id: '',
      tenantId: props.tenantId,
      sku: props.sku.trim().toUpperCase(),
      barcode: props.barcode?.trim(),
      name: props.name.trim(),
      description: props.description?.trim(),
      categoryId: props.categoryId,
      tracking: props.tracking ?? 'NONE',
      ivaRate,
      internalTaxRate: props.internalTaxRate ?? '0.00',
      costMethod: props.costMethod ?? 'FIFO',
      standardCostUsd: props.standardCostUsd,
      listPriceArs: props.listPriceArs,
      weightKg: props.weightKg,
      uom: props.uom ?? 'UN',
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static hydrate(state: ProductState): Product {
    return new Product(state);
  }

  // ---- Getters ----
  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get sku(): string { return this.state.sku; }
  get name(): string { return this.state.name; }
  get tracking(): TrackingType { return this.state.tracking; }
  get requiresSerial(): boolean { return this.state.tracking === 'SERIAL'; }
  get ivaRate(): string { return this.state.ivaRate; }
  get isActive(): boolean { return this.state.isActive; }
  get version(): number { return this.state.version; }
  get uom(): string { return this.state.uom; }

  toState(): Readonly<ProductState> {
    return { ...this.state };
  }

  // ---- Comandos ----

  updateListPrice(newPrice: string): void {
    const n = Number(newPrice);
    if (Number.isNaN(n) || n < 0) {
      throw new ValidationError('listPriceArs must be a non-negative number');
    }
    this.state.listPriceArs = newPrice;
    this.state.updatedAt = new Date();
  }

  deactivate(): void {
    if (!this.state.isActive) {
      throw new BusinessRuleError('PRODUCT_ALREADY_INACTIVE', 'Product is already inactive');
    }
    this.state.isActive = false;
    this.state.updatedAt = new Date();
  }

  /**
   * Cambio de tracking: SOLO permitido si se verifica externamente que no hay
   * movimientos de stock. Lo chequea el application service antes de llamar.
   */
  changeTracking(newTracking: TrackingType): void {
    if (this.state.tracking === newTracking) return;
    this.state.tracking = newTracking;
    this.state.updatedAt = new Date();
  }
}
