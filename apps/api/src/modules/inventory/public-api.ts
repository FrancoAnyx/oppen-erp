/**
 * Public API del módulo Inventory.
 *
 * REGLA: los otros módulos (Sales, Purchases, Fiscal) solo pueden importar
 * desde este archivo. Nunca desde `./domain/...` o `./infrastructure/...`.
 *
 * Esto significa que podés refactorizar el interno del módulo (cambiar cómo
 * funciona StockMove, mover archivos, renombrar clases internas) sin romper
 * a los consumidores, siempre que no cambies este archivo.
 *
 * Si necesitás que otro módulo acceda a algo que no está acá, agregalo acá
 * primero, con un alias estable.
 */

// ---- Services (uso operacional) ----
export { StockReservationService } from './application/services/stock-reservation.service';
export { StockCalculatorService } from './application/services/stock-calculator.service';
export { StockReceiptService } from './application/services/stock-receipt.service';
export { ProductService } from './application/product.service';

// ---- Value Objects (solo tipos, para construir parámetros/respuestas) ----
export { StockQuantities } from './domain/value-objects/stock-quantities';

// ---- Tipos de dominio re-exportados ----
// Exportamos las interfaces de tipo pero NO las clases — los otros módulos
// nunca deberían instanciar un Product o un StockMove directamente.
export type {
  TrackingType,
  CostMethod,
  ProductState,
} from './domain/entities/product';
export type { LocationType, LocationState } from './domain/entities/location';
export type {
  MoveState,
  OriginDocType,
  StockMoveState,
} from './domain/entities/stock-move';

// ---- Módulo NestJS ----
export { InventoryModule } from './inventory.module';

