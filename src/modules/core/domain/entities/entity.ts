// Value Object: CUIT
export class Cuit {
  private readonly value: string;

  constructor(raw: string) {
    const clean = raw.replace(/-/g, '');
    if (!/^\d{11}$/.test(clean)) {
      throw new Error(`Invalid CUIT: ${raw}`);
    }
    this.value = clean;
  }

  format(): string {
    return `${this.value.slice(0, 2)}-${this.value.slice(2, 10)}-${this.value.slice(10)}`;
  }

  toString(): string { return this.value; }
  equals(other: Cuit): boolean { return this.value === other.value; }
}

export type EntityRole = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
export type IvaCondition = 'RI' | 'MONOTRIBUTO' | 'EXENTO' | 'CF' | 'NO_RESPONSABLE';

export interface EntityState {
  id: string;
  tenantId: string;
  roles: EntityRole[];
  legalName: string;
  tradeName?: string;
  taxId: string;
  ivaCondition: IvaCondition;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  zipCode?: string;
  creditLimit?: string;   // decimal como string
  paymentTermDays?: number;
  notes?: string;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Entity {
  readonly cuit: Cuit;

  private constructor(private state: EntityState) {
    this.cuit = new Cuit(state.taxId);
  }

  static create(params: Omit<EntityState, 'version' | 'createdAt' | 'updatedAt' | 'isActive'> & {
    createdAt?: Date;
    updatedAt?: Date;
  }): Entity {
    const now = new Date();
    return new Entity({
      ...params,
      isActive: true,
      version: 0,
      createdAt: params.createdAt ?? now,
      updatedAt: params.updatedAt ?? now,
    });
  }

  static reconstitute(state: EntityState): Entity {
    return new Entity(state);
  }

  updateContact(fields: {
    email?: string;
    phone?: string;
    address?: string;
  }): void {
    if (!this.state.isActive) {
      throw new Error('Cannot update inactive entity');
    }
    Object.assign(this.state, { ...fields, updatedAt: new Date() });
  }

  deactivate(): void {
    this.state.isActive = false;
    this.state.updatedAt = new Date();
  }

  toState(): Readonly<EntityState> {
    return { ...this.state };
  }

  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get version(): number { return this.state.version; }
  get isActive(): boolean { return this.state.isActive; }
}