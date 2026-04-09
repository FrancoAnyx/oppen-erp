import { SalesOrder } from '../entities/sales-order';

/**
 * Port del repositorio de SalesOrder.
 *
 * Reglas:
 *   - create() y update() hacen mapping PrismaModel ↔ DomainEntity en los bordes
 *   - update() implementa optimistic locking: si version no matchea → ConcurrencyError
 *   - findById() carga las líneas en el mismo query (include lines)
 *   - Nunca devuelve modelos Prisma — solo el aggregate de dominio
 */
export interface ISalesOrderRepository {
  /**
   * Busca por id incluyendo todas las líneas.
   */
  findById(tenantId: string, id: string): Promise<SalesOrder | null>;

  /**
   * Busca por número de OV (el número legible, no el id).
   */
  findByOrderNumber(tenantId: string, orderNumber: number): Promise<SalesOrder | null>;

  /**
   * Listado paginado con filtros opcionales.
   */
  findMany(params: {
    tenantId: string;
    customerId?: string;
    state?: string | string[];
    search?: string;     // busca en número de OV o nombre de cliente
    skip?: number;
    take?: number;
  }): Promise<{ items: SalesOrder[]; total: number }>;

  /**
   * Persiste una OV nueva. Asigna ids a la OV y a sus líneas.
   * Crea la OV y las líneas en la misma transacción.
   */
  create(order: SalesOrder): Promise<SalesOrder>;

  /**
   * Actualiza una OV existente con sus líneas (upsert de líneas).
   * Implementa optimistic locking — lanza ConcurrencyError si version mismatch.
   */
  update(order: SalesOrder): Promise<SalesOrder>;

  /**
   * Obtiene el próximo número de secuencia para una OV.
   * Usa nextval('sales.sales_order_number_seq') — nunca MAX+1.
   */
  nextOrderNumber(tenantId: string): Promise<number>;
}

export const SALES_ORDER_REPOSITORY = Symbol('ISalesOrderRepository');

