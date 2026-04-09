export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
export type TrackingType = 'NONE' | 'LOT' | 'SERIAL';

export interface ProductState {
  id: string;
  tenantId: string;
  sku: string;
  name: string;
  description?: string;
  categoryId?: string;
  brandId?: string;
  unitOfMeasure: string;           // 'UN', 'KG', 'M2', etc.
  trackingType: TrackingType;
  requiresSerial: boolean;         // true → TrackingType.SERIAL obligatorio
  costPrice: string;               // Decimal como string (decimal.js)
  listPrice: string;               // Precio de lista en ARS
  taxRate: string;                 // '21.00', '10.50', '0.00'
  weight?: string;                 // kg
  status: ProductStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Product {
  private constructor(private state: ProductState) {}

  static create(
    params: Omit<ProductState, 'version' | 'status' | 'createdAt' | 'updatedAt'>,
  ): Product {
    const now = new Date();
    return new Product({
      ...params,
      status: 'ACTIVE',
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(state: ProductState): Product {
    return new Product(state);
  }

  updatePrices(costPrice: string, listPrice: string): void {
    if (this.state.status === 'DISCONTINUED') {
      throw new Error(`Cannot update prices of discontinued product ${this.state.sku}`);
    }
    this.state.costPrice = costPrice;
    this.state.listPrice = listPrice;
    this.state.updatedAt = new Date();
  }

  discontinue(): void {
    this.state.status = 'DISCONTINUED';
    this.state.updatedAt = new Date();
  }

  toState(): Readonly<ProductState> {
    return { ...this.state };
  }

  get id(): string { return this.state.id; }
  get sku(): string { return this.state.sku; }
  get tenantId(): string { return this.state.tenantId; }
  get version(): number { return this.state.version; }
  get requiresSerial(): boolean { return this.state.requiresSerial; }
  get trackingType(): TrackingType { return this.state.trackingType; }
}