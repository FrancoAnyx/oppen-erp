import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { StockQuantities } from '../../domain/value-objects/stock-quantities';

/**
 * StockCalculatorService — lee el estado de stock desde la vista SQL
 * `inventory.v_stock_quantities` y arma los Value Objects de dominio.
 *
 * IMPORTANTE: este servicio NO debe usarse durante reservas — el ReservationService
 * tiene su propio camino con lock. Usar esto solo para:
 *   - Listados de productos con stock en la UI
 *   - Dashboards
 *   - Reportes
 *
 * Para decisiones de negocio ("¿puedo vender?") usar ReservationService.
 */
@Injectable()
export class StockCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Devuelve el stock total de un producto agregado entre TODAS las locations
   * internas del tenant. Útil para el listado principal de productos.
   */
  async getTotalStock(tenantId: string, productId: string): Promise<StockQuantities> {
    // Llamamos a la función SQL que hace la agregación en el server de DB
    const rows = await this.prisma.$queryRaw<
      Array<{
        physical: string;
        available: string;
        committed: string;
        incoming: string;
      }>
    >`
      SELECT
        physical::text,
        available::text,
        committed::text,
        incoming::text
      FROM inventory.get_stock_summary(${tenantId}::text, ${productId}::text)
    `;

    const row = rows[0];
    if (!row) return StockQuantities.zero();

    return StockQuantities.of({
      physical: row.physical,
      committed: row.committed,
      incoming: row.incoming,
    });
  }

  /**
   * Devuelve el stock en una location específica.
   */
  async getStockAt(
    tenantId: string,
    productId: string,
    locationId: string,
  ): Promise<StockQuantities> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        physical_qty: string;
        committed_qty: string;
        incoming_qty: string;
      }>
    >`
      SELECT
        physical_qty::text,
        committed_qty::text,
        incoming_qty::text
      FROM inventory.v_stock_quantities
      WHERE tenant_id = ${tenantId}
        AND product_id = ${productId}
        AND location_id = ${locationId}
    `;

    const row = rows[0];
    if (!row) return StockQuantities.zero();

    return StockQuantities.of({
      physical: row.physical_qty,
      committed: row.committed_qty,
      incoming: row.incoming_qty,
    });
  }

  /**
   * Versión bulk: stock de varios productos de una vez.
   * Usado en listados (evita N+1 queries).
   */
  async getTotalStockBulk(
    tenantId: string,
    productIds: string[],
  ): Promise<Map<string, StockQuantities>> {
    if (productIds.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string;
        physical: string;
        committed: string;
        incoming: string;
      }>
    >`
      SELECT
        product_id,
        COALESCE(SUM(physical_qty), 0)::text AS physical,
        COALESCE(SUM(committed_qty), 0)::text AS committed,
        COALESCE(SUM(incoming_qty), 0)::text AS incoming
      FROM inventory.v_stock_quantities
      WHERE tenant_id = ${tenantId}
        AND product_id = ANY(${productIds}::text[])
        AND loc_type = 'INTERNAL'
      GROUP BY product_id
    `;

    const result = new Map<string, StockQuantities>();
    for (const row of rows) {
      result.set(
        row.product_id,
        StockQuantities.of({
          physical: row.physical,
          committed: row.committed,
          incoming: row.incoming,
        }),
      );
    }
    // Productos sin moves: devolver zero
    for (const id of productIds) {
      if (!result.has(id)) result.set(id, StockQuantities.zero());
    }
    return result;
  }
}

