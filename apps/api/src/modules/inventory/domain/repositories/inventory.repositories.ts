import { Product } from '../entities/product';
import { Location, LocationType } from '../entities/location';
import { StockMove, OriginDocType, MoveState } from '../entities/stock-move';

// =============================================================================
// Product repository
// =============================================================================

export interface IProductRepository {
  findById(tenantId: string, id: string): Promise<Product | null>;
  findBySku(tenantId: string, sku: string): Promise<Product | null>;

  findMany(params: {
    tenantId: string;
    search?: string;
    categoryId?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Product[]; total: number }>;

  create(product: Product): Promise<Product>;
  update(product: Product): Promise<Product>;

  /**
   * Retorna true si el producto ya tiene al menos un stock move NO cancelado.
   * Usado por el caso de uso de "cambiar tracking" para bloquear cambios
   * cuando ya hay historia.
   */
  hasAnyMoves(tenantId: string, productId: string): Promise<boolean>;
}

export const PRODUCT_REPOSITORY = Symbol('IProductRepository');

// =============================================================================
// Location repository
// =============================================================================

export interface ILocationRepository {
  findById(tenantId: string, id: string): Promise<Location | null>;
  findByCode(tenantId: string, code: string): Promise<Location | null>;
  findByType(tenantId: string, type: LocationType): Promise<Location[]>;
  findAll(tenantId: string): Promise<Location[]>;
  create(location: Location): Promise<Location>;

  /**
   * Obtiene la location principal de un tipo dado. Usado por los defaults
   * del reservation service — si no hay ninguna, lanza NotFoundError.
   */
  getDefaultByType(tenantId: string, type: LocationType): Promise<Location>;
}

export const LOCATION_REPOSITORY = Symbol('ILocationRepository');

// =============================================================================
// Stock Move repository
// =============================================================================

export interface IStockMoveRepository {
  findById(tenantId: string, id: string): Promise<StockMove | null>;
  findByOrigin(
    tenantId: string,
    docType: OriginDocType,
    docId: string,
  ): Promise<StockMove[]>;

  findMany(params: {
    tenantId: string;
    productId?: string;
    state?: MoveState;
    locationId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: StockMove[]; total: number }>;

  create(move: StockMove): Promise<StockMove>;

  /**
   * Actualiza el estado de un move. No usamos optimistic locking por version
   * porque los moves tienen transiciones válidas conocidas — la integridad la
   * garantiza la state machine + el filter del estado actual en el WHERE.
   */
  updateState(move: StockMove): Promise<StockMove>;
}

export const STOCK_MOVE_REPOSITORY = Symbol('IStockMoveRepository');

