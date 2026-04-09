import type { Product } from '../entities/product';

// ─── Tokens de inyección (DIP) ───────────────────────────────────────────────
export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');
export const STOCK_MOVE_REPOSITORY = Symbol('STOCK_MOVE_REPOSITORY');

// ─── Product Repository Port ────────────────────────────────────────────────
export interface ListProductsFilter {
  tenantId: string;
  categoryId?: string;
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  skip?: number;
  take?: number;
}

export interface IProductRepository {
  save(product: Product): Promise<void>;
  findById(tenantId: string, id: string): Promise<Product | null>;
  findBySku(tenantId: string, sku: string): Promise<Product | null>;
  list(filter: ListProductsFilter): Promise<{ items: Product[]; total: number }>;
  update(product: Product, expectedVersion: number): Promise<void>;
}

// ─── Stock Query Types ───────────────────────────────────────────────────────
export interface StockQuantity {
  productId: string;
  locationId: string;
  physical: string;      // decimal string
  available: string;     // physical - committed
  committed: string;     // reservado por OV
  incoming: string;      // en tránsito (OC confirmada)
}

export interface IStockMoveRepository {
  /**
   * Obtiene cantidades agregadas de stock para un producto.
   * Usa la vista v_stock_quantities de Postgres.
   */
  getQuantities(tenantId: string, productId: string): Promise<StockQuantity[]>;

  /**
   * Reserva atómica: SELECT ... FOR UPDATE + validación de disponible.
   * Lanza InsufficientStockError si available < qty.
   */
  reserve(params: {
    tenantId: string;
    productId: string;
    locationId: string;
    qty: string;
    referenceDocId: string;
    referenceDocType: 'SALES_ORDER';
  }): Promise<{ moveId: string }>;

  /**
   * Libera una reserva previa.
   */
  release(params: {
    tenantId: string;
    moveId: string;
  }): Promise<void>;
}