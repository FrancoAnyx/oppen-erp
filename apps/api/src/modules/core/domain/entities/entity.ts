import { Cuit, BusinessRuleError, ValidationError } from '@erp/shared';

/**
 * Tipos de entity que puede tener un registro.
 * Un mismo registro puede ser cliente Y proveedor al mismo tiempo — es muy
 * común en reseller tech (ej: un mayorista que también te vende productos).
 */
export type EntityRole = 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';

export type IvaCondition =
  | 'RI'            // Responsable Inscripto
  | 'MONOTRIBUTO'
  | 'EXENTO'
  | 'CF'            // Consumidor Final
  | 'NO_RESPONSABLE';

/**
 * DTO de creación de Entity. Los campos opcionales son opcionales en dominio.
 */
export interface CreateEntityProps {
  tenantId: string;
  roles: EntityRole[];
  legalName: string;
  tradeName?: string;
  taxId: string; // se valida con Cuit VO
  ivaCondition: IvaCondition;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  zipCode?: string;
  creditLimit?: string; // Decimal como string para no perder precisión
  paymentTermDays?: number;
  notes?: string;
}

/**
 * Estado persistido (lo que viene de la DB).
 */
export interface EntityState extends CreateEntityProps {
  id: string;
  isActive: boolean;
  version: number;
  padronData: Record<string, unknown> | null;
  padronSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entity — Aggregate root del bounded context Core.
 *
 * Invariantes:
 *   - taxId debe ser un CUIT válido (dígito verificador correcto)
 *   - roles no puede estar vacío
 *   - legalName no vacío
 *   - creditLimit >= 0
 *   - taxId único por tenant (chequeado en repositorio)
 */
export class Entity {
  private constructor(private state: EntityState) {}

  // ---- Factories ----

  /**
   * Crea una nueva Entity (aún sin persistir).
   * Valida todas las invariantes del dominio.
   */
  static create(props: CreateEntityProps): Entity {
    // Validar CUIT (lanza ValidationError si es inválido)
    const cuit = Cuit.of(props.taxId);

    if (props.roles.length === 0) {
      throw new BusinessRuleError(
        'ENTITY_NO_ROLES',
        'Entity must have at least one role (CUSTOMER/SUPPLIER/CARRIER)',
      );
    }

    if (props.legalName.trim().length === 0) {
      throw new ValidationError('legalName cannot be empty');
    }

    if (props.creditLimit !== undefined) {
      const n = Number(props.creditLimit);
      if (Number.isNaN(n) || n < 0) {
        throw new ValidationError('creditLimit must be >= 0', {
          creditLimit: props.creditLimit,
        });
      }
    }

    if (props.paymentTermDays !== undefined && props.paymentTermDays < 0) {
      throw new ValidationError('paymentTermDays must be >= 0');
    }

    // Por el momento no asignamos id — lo hace el repositorio con cuid()
    return new Entity({
      id: '',
      tenantId: props.tenantId,
      roles: props.roles,
      legalName: props.legalName.trim(),
      tradeName: props.tradeName?.trim() ?? undefined,
      taxId: cuit.value, // canonicalizado (sin guiones)
      ivaCondition: props.ivaCondition,
      email: props.email?.toLowerCase().trim() ?? undefined,
      phone: props.phone?.trim() ?? undefined,
      address: props.address?.trim() ?? undefined,
      city: props.city?.trim() ?? undefined,
      province: props.province?.trim() ?? undefined,
      zipCode: props.zipCode?.trim() ?? undefined,
      creditLimit: props.creditLimit ?? '0.00',
      paymentTermDays: props.paymentTermDays ?? 0,
      notes: props.notes ?? undefined,
      isActive: true,
      version: 1,
      padronData: null,
      padronSyncedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Hidrata una Entity desde la DB — NO valida porque confiamos en los datos.
   */
  static hydrate(state: EntityState): Entity {
    return new Entity(state);
  }

  // ---- Getters ----

  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get roles(): EntityRole[] { return [...this.state.roles]; }
  get legalName(): string { return this.state.legalName; }
  get tradeName(): string | undefined { return this.state.tradeName; }
  get taxId(): string { return this.state.taxId; }
  get cuit(): Cuit { return Cuit.unsafeFromDb(this.state.taxId); }
  get ivaCondition(): IvaCondition { return this.state.ivaCondition; }
  get email(): string | undefined { return this.state.email; }
  get isActive(): boolean { return this.state.isActive; }
  get version(): number { return this.state.version; }
  get creditLimit(): string { return this.state.creditLimit ?? '0.00'; }
  get paymentTermDays(): number { return this.state.paymentTermDays ?? 0; }

  isCustomer(): boolean { return this.state.roles.includes('CUSTOMER'); }
  isSupplier(): boolean { return this.state.roles.includes('SUPPLIER'); }

  /**
   * Devuelve el estado plano para persistencia.
   */
  toState(): Readonly<EntityState> {
    return { ...this.state };
  }

  // ---- Comandos del dominio ----

  deactivate(): void {
    if (!this.state.isActive) {
      throw new BusinessRuleError(
        'ENTITY_ALREADY_INACTIVE',
        'Entity is already inactive',
        { id: this.state.id },
      );
    }
    this.state.isActive = false;
    this.state.updatedAt = new Date();
  }

  reactivate(): void {
    if (this.state.isActive) {
      throw new BusinessRuleError(
        'ENTITY_ALREADY_ACTIVE',
        'Entity is already active',
        { id: this.state.id },
      );
    }
    this.state.isActive = true;
    this.state.updatedAt = new Date();
  }

  updateContactInfo(props: {
    email?: string;
    phone?: string;
    address?: string;
  }): void {
    if (props.email !== undefined) this.state.email = props.email.toLowerCase().trim();
    if (props.phone !== undefined) this.state.phone = props.phone.trim();
    if (props.address !== undefined) this.state.address = props.address.trim();
    this.state.updatedAt = new Date();
  }

  applyPadronSnapshot(data: Record<string, unknown>): void {
    this.state.padronData = data;
    this.state.padronSyncedAt = new Date();
    this.state.updatedAt = new Date();
  }
}
