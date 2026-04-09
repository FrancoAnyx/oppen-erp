import { IllegalStateTransitionError, ValidationError, Quantity } from '@erp/shared';

export type MoveState = 'DRAFT' | 'CONFIRMED' | 'ASSIGNED' | 'DONE' | 'CANCELLED';

/**
 * Tipos de documento origen que pueden crear stock moves.
 * Este es un enum "abierto" (string literal) porque cuando agreguemos módulos
 * nuevos (RMA, Production, Transfer...) vamos a sumar tipos sin tocar dominio.
 */
export type OriginDocType =
  | 'SO'         // Sales Order
  | 'PO'         // Purchase Order
  | 'RECEIPT'    // Recepción directa (sin OC, ej: stock inicial)
  | 'DELIVERY'   // Remito (entrega)
  | 'TRANSFER'   // Transferencia interna entre depósitos
  | 'ADJUSTMENT' // Ajuste manual de inventario
  | 'RMA';       // Devolución

export interface StockMoveState {
  id: string;
  tenantId: string;
  productId: string;
  quantity: Quantity;
  uom: string;
  sourceLocationId: string;
  destLocationId: string;
  state: MoveState;
  originDocType: OriginDocType;
  originDocId: string;
  originLineId?: string;
  unitCost?: string;
  unitCostUsd?: string;
  fxRate?: string;
  scheduledDate: Date;
  doneDate?: Date;
  createdById: string;
  createdAt: Date;
  cancelledAt?: Date;
  cancelReason?: string;
}

export interface CreateStockMoveProps {
  tenantId: string;
  productId: string;
  quantity: string | number;
  uom?: string;
  sourceLocationId: string;
  destLocationId: string;
  originDocType: OriginDocType;
  originDocId: string;
  originLineId?: string;
  unitCost?: string;
  unitCostUsd?: string;
  fxRate?: string;
  scheduledDate?: Date;
  createdById: string;
}

/**
 * StockMove — una transferencia de cantidad entre dos locations.
 *
 * INVARIANTES CRÍTICAS:
 *   - quantity > 0 siempre (la dirección la da source → dest)
 *   - source != dest (constraint en DB también)
 *   - Los campos financieros (unitCost, etc) son opcionales — no todos los
 *     moves tienen costo asociado (ej: transferencia interna)
 *
 * STATE MACHINE:
 *
 *   DRAFT ──┬──> CONFIRMED ──> ASSIGNED ──> DONE
 *           │                    │            │
 *           └──> CANCELLED <─────┴────────────┘
 *
 *   - DRAFT:     no afecta ningún contador. Usado para moves "propuestos"
 *                que pueden borrarse sin auditoría.
 *   - CONFIRMED: el move es parte oficial del sistema. Afecta Committed
 *                (si sale de INTERNAL) o Incoming (si entra desde SUPPLIER).
 *                Esta es la primera transición "visible" al usuario.
 *   - ASSIGNED:  se le asignaron series específicas (solo para productos
 *                con tracking = SERIAL). Es como CONFIRMED pero con detalle.
 *   - DONE:      ejecutado. Afecta Physical. Inmutable desde este punto —
 *                para revertir hay que crear un move inverso (origen RMA o
 *                ADJUSTMENT).
 *   - CANCELLED: anulado. Se conserva para auditoría pero no cuenta en cálculos.
 */
export class StockMove {
  private constructor(private state: StockMoveState) {}

  static create(props: CreateStockMoveProps): StockMove {
    if (props.sourceLocationId === props.destLocationId) {
      throw new ValidationError(
        'source and destination locations must be different',
        { source: props.sourceLocationId, dest: props.destLocationId },
      );
    }

    const quantity = Quantity.of(props.quantity);
    if (quantity.isZero()) {
      throw new ValidationError('Stock move quantity must be greater than zero');
    }

    return new StockMove({
      id: '',
      tenantId: props.tenantId,
      productId: props.productId,
      quantity,
      uom: props.uom ?? 'UN',
      sourceLocationId: props.sourceLocationId,
      destLocationId: props.destLocationId,
      state: 'DRAFT',
      originDocType: props.originDocType,
      originDocId: props.originDocId,
      originLineId: props.originLineId,
      unitCost: props.unitCost,
      unitCostUsd: props.unitCostUsd,
      fxRate: props.fxRate,
      scheduledDate: props.scheduledDate ?? new Date(),
      createdById: props.createdById,
      createdAt: new Date(),
    });
  }

  static hydrate(state: StockMoveState): StockMove {
    return new StockMove(state);
  }

  // ---- Getters ----
  get id(): string { return this.state.id; }
  get state_(): MoveState { return this.state.state; } // "state" colisiona con field
  get quantity(): Quantity { return this.state.quantity; }
  get productId(): string { return this.state.productId; }
  get sourceLocationId(): string { return this.state.sourceLocationId; }
  get destLocationId(): string { return this.state.destLocationId; }
  get originDocType(): OriginDocType { return this.state.originDocType; }
  get originDocId(): string { return this.state.originDocId; }

  toState(): Readonly<StockMoveState> {
    return { ...this.state };
  }

  // ---- Transiciones ----

  confirm(): void {
    this.assertTransition(['DRAFT'], 'confirm');
    this.state.state = 'CONFIRMED';
  }

  /**
   * ASSIGNED = a este move se le eligieron números de serie específicos.
   * Solo aplica para productos con tracking SERIAL. La asignación real de
   * series se hace en la tabla pivot stock_move_serials — este método solo
   * cambia el estado del aggregate.
   */
  assignSerials(): void {
    this.assertTransition(['CONFIRMED'], 'assignSerials');
    this.state.state = 'ASSIGNED';
  }

  /**
   * DONE = el move se ejecutó físicamente (mercadería movida).
   * Desde este punto es inmutable. Afecta Physical.
   */
  markDone(): void {
    this.assertTransition(['CONFIRMED', 'ASSIGNED'], 'markDone');
    this.state.state = 'DONE';
    this.state.doneDate = new Date();
  }

  cancel(reason: string): void {
    // DONE no se puede cancelar — para revertir, crear move inverso
    this.assertTransition(['DRAFT', 'CONFIRMED', 'ASSIGNED'], 'cancel');
    if (reason.trim().length === 0) {
      throw new ValidationError('Cancel reason cannot be empty');
    }
    this.state.state = 'CANCELLED';
    this.state.cancelledAt = new Date();
    this.state.cancelReason = reason.trim();
  }

  private assertTransition(allowedFrom: MoveState[], action: string): void {
    if (!allowedFrom.includes(this.state.state)) {
      throw new IllegalStateTransitionError('StockMove', this.state.state, action);
    }
  }
}
