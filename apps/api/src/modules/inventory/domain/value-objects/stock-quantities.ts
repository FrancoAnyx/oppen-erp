import { Quantity } from '@erp/shared';

/**
 * StockQuantities — snapshot de los estados de stock de un producto en
 * un momento dado (y típicamente en una location específica).
 *
 * Los 5 estados NO son independientes:
 *   Physical  = lo que efectivamente está en el depósito (moves DONE)
 *   Committed = reservado por OV (moves CONFIRMED saliendo hacia CUSTOMER)
 *   Incoming  = en camino desde proveedor (moves CONFIRMED entrando desde SUPPLIER)
 *   RMA       = devoluciones pendientes de procesar
 *   Available = Physical - Committed (lo que se puede vender YA)
 *
 * Esta clase es un DTO inmutable. La calcula StockCalculatorService leyendo
 * de la vista `inventory.v_stock_quantities`.
 */
export class StockQuantities {
  private constructor(
    public readonly physical: Quantity,
    public readonly committed: Quantity,
    public readonly incoming: Quantity,
    public readonly rma: Quantity,
  ) {}

  static of(params: {
    physical: string | number;
    committed: string | number;
    incoming: string | number;
    rma?: string | number;
  }): StockQuantities {
    return new StockQuantities(
      Quantity.of(params.physical),
      Quantity.of(params.committed),
      Quantity.of(params.incoming),
      Quantity.of(params.rma ?? 0),
    );
  }

  static zero(): StockQuantities {
    return new StockQuantities(Quantity.zero(), Quantity.zero(), Quantity.zero(), Quantity.zero());
  }

  /**
   * Available = Physical - Committed.
   * Si Committed > Physical (over-commit), retorna 0 en lugar de negativo.
   */
  get available(): Quantity {
    if (this.committed.greaterThan(this.physical)) {
      return Quantity.zero();
    }
    return this.physical.subtract(this.committed);
  }

  /**
   * Útil para saber si se puede satisfacer una cantidad pedida.
   */
  canReserve(qty: Quantity): boolean {
    return this.available.greaterThanOrEqual(qty);
  }

  toJSON() {
    return {
      physical: this.physical.toString(),
      available: this.available.toString(),
      committed: this.committed.toString(),
      incoming: this.incoming.toString(),
      rma: this.rma.toString(),
    };
  }
}
