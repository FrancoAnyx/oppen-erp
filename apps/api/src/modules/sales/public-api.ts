/**
 * Public API del módulo Sales.
 *
 * REGLA: los otros módulos (Fiscal, Purchases) SOLO pueden importar
 * desde este archivo. Nunca desde `./domain/...` o `./infrastructure/...`.
 */

// ---- Módulo NestJS ----
export { SalesModule } from './sales.module';

// ---- Use cases que otros módulos pueden necesitar ----
// (Fiscal los necesitará para marcar OVs como INVOICED)
export { ConfirmSalesOrderUseCase } from './application/use-cases/confirm-sales-order.use-case';
export { CancelSalesOrderUseCase } from './application/use-cases/cancel-sales-order.use-case';

// ---- Repository token (para que Fiscal pueda inyectar el repo) ----
export { SALES_ORDER_REPOSITORY } from './domain/repositories/sales.repositories';
export type { ISalesOrderRepository } from './domain/repositories/sales.repositories';

// ---- Tipos de dominio ----
export type { SalesOrderState } from './domain/entities/sales-order';

