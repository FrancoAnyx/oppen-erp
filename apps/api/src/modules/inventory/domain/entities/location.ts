import { ValidationError } from '@erp/shared';

export type LocationType =
  | 'INTERNAL'       // Depósito físico real
  | 'CUSTOMER'       // Virtual: stock entregado al cliente
  | 'SUPPLIER'       // Virtual: stock comprometido por proveedor
  | 'TRANSIT'        // En tránsito (importación)
  | 'INVENTORY_LOSS' // Ajustes negativos
  | 'PRODUCTION'     // Ensamble
  | 'RMA';           // Devoluciones pendientes

export interface LocationState {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  locationType: LocationType;
  parentId?: string;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Location — depósitos físicos y virtuales.
 *
 * Las locations virtuales (CUSTOMER, SUPPLIER, etc) son la clave del modelo
 * de double-entry: cada move es una transferencia entre dos locations.
 * Nunca se crean ni destruyen durante operaciones de negocio, solo en setup.
 */
export class Location {
  private constructor(private state: LocationState) {}

  static create(props: {
    tenantId: string;
    code: string;
    name: string;
    locationType: LocationType;
    parentId?: string;
  }): Location {
    if (props.code.trim().length === 0) {
      throw new ValidationError('Location code cannot be empty');
    }
    if (!/^[A-Z0-9\-_]+$/.test(props.code)) {
      throw new ValidationError(
        'Location code must be uppercase alphanumeric (with dash/underscore)',
      );
    }
    return new Location({
      id: '',
      tenantId: props.tenantId,
      code: props.code.trim(),
      name: props.name.trim(),
      locationType: props.locationType,
      parentId: props.parentId,
      isActive: true,
      createdAt: new Date(),
    });
  }

  static hydrate(state: LocationState): Location {
    return new Location(state);
  }

  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get code(): string { return this.state.code; }
  get name(): string { return this.state.name; }
  get locationType(): LocationType { return this.state.locationType; }
  get isPhysical(): boolean { return this.state.locationType === 'INTERNAL'; }
  get isVirtual(): boolean { return !this.isPhysical; }
  get isActive(): boolean { return this.state.isActive; }

  toState(): Readonly<LocationState> {
    return { ...this.state };
  }
}
