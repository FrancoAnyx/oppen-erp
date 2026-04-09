// ============================================================
// src/modules/auth/domain/entities/user.entity.ts
// ============================================================

export enum UserRole {
  ADMIN = 'ADMIN',
  VENDEDOR = 'VENDEDOR',
  COMPRAS = 'COMPRAS',
  CONTABLE = 'CONTABLE',
  READONLY = 'READONLY',
}

export enum UserStatus {
  PENDING_ACTIVATION = 'PENDING_ACTIVATION', // invitado, sin contraseña
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface UserProps {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  inviteToken: string | null;
  inviteTokenExpiresAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UserEntity {
  constructor(private readonly props: UserProps) {}

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get email() { return this.props.email; }
  get passwordHash() { return this.props.passwordHash; }
  get firstName() { return this.props.firstName; }
  get lastName() { return this.props.lastName; }
  get fullName() { return `${this.props.firstName} ${this.props.lastName}`; }
  get role() { return this.props.role; }
  get status() { return this.props.status; }
  get inviteToken() { return this.props.inviteToken; }
  get inviteTokenExpiresAt() { return this.props.inviteTokenExpiresAt; }

  isActive(): boolean {
    return this.props.status === UserStatus.ACTIVE;
  }

  isInviteValid(): boolean {
    if (!this.props.inviteToken || !this.props.inviteTokenExpiresAt) return false;
    return new Date() < this.props.inviteTokenExpiresAt;
  }

  canDo(action: AuthAction): boolean {
    return ROLE_PERMISSIONS[this.props.role]?.includes(action) ?? false;
  }

  toJSON(): Omit<UserProps, 'passwordHash' | 'inviteToken'> {
    const { passwordHash, inviteToken, ...safe } = this.props;
    return safe;
  }
}

// ============================================================
// Permisos por rol
// ============================================================
export enum AuthAction {
  // Usuarios
  USERS_READ = 'users:read',
  USERS_WRITE = 'users:write',
  USERS_INVITE = 'users:invite',
  // Ventas
  SALES_READ = 'sales:read',
  SALES_WRITE = 'sales:write',
  // Compras
  PURCHASE_READ = 'purchase:read',
  PURCHASE_WRITE = 'purchase:write',
  // Inventario
  INVENTORY_READ = 'inventory:read',
  INVENTORY_WRITE = 'inventory:write',
  INVENTORY_ADJUST = 'inventory:adjust',
  // Fiscal
  FISCAL_READ = 'fiscal:read',
  FISCAL_EMIT = 'fiscal:emit',
  // Finanzas
  FINANCE_READ = 'finance:read',
  FINANCE_WRITE = 'finance:write',
  // Config
  CONFIG_WRITE = 'config:write',
}

export const ROLE_PERMISSIONS: Record<UserRole, AuthAction[]> = {
  [UserRole.ADMIN]: Object.values(AuthAction),

  [UserRole.VENDEDOR]: [
    AuthAction.SALES_READ,
    AuthAction.SALES_WRITE,
    AuthAction.INVENTORY_READ,
    AuthAction.PURCHASE_READ,
    AuthAction.FISCAL_READ,
    AuthAction.FINANCE_READ,
  ],

  [UserRole.COMPRAS]: [
    AuthAction.PURCHASE_READ,
    AuthAction.PURCHASE_WRITE,
    AuthAction.INVENTORY_READ,
    AuthAction.INVENTORY_WRITE,
    AuthAction.SALES_READ,
  ],

  [UserRole.CONTABLE]: [
    AuthAction.FISCAL_READ,
    AuthAction.FISCAL_EMIT,
    AuthAction.FINANCE_READ,
    AuthAction.FINANCE_WRITE,
    AuthAction.SALES_READ,
    AuthAction.PURCHASE_READ,
    AuthAction.INVENTORY_READ,
  ],

  [UserRole.READONLY]: [
    AuthAction.SALES_READ,
    AuthAction.PURCHASE_READ,
    AuthAction.INVENTORY_READ,
    AuthAction.FISCAL_READ,
    AuthAction.FINANCE_READ,
  ],
};
