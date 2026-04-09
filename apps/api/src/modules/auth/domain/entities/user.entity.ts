import { BusinessRuleError, ValidationError } from '@erp/shared';

export type UserRole = 'ADMIN' | 'MANAGER' | 'USER' | 'VIEWER';

export interface UserState {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: Date;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User — aggregate del bounded context Auth.
 *
 * Invariantes:
 *   - email válido (regex básico — la validación profunda es responsabilidad del MX lookup)
 *   - passwordHash NUNCA se expone por getters públicos
 *   - Un usuario inactivo no puede autenticarse
 */
export class User {
  private constructor(private readonly state: UserState) {}

  static hydrate(state: UserState): User {
    return new User(state);
  }

  // ---- Getters (sin exponer passwordHash) ----
  get id(): string { return this.state.id; }
  get tenantId(): string { return this.state.tenantId; }
  get email(): string { return this.state.email; }
  get fullName(): string { return this.state.fullName; }
  get role(): UserRole { return this.state.role; }
  get isActive(): boolean { return this.state.isActive; }
  get lastLoginAt(): Date | undefined { return this.state.lastLoginAt; }
  get version(): number { return this.state.version ?? 1; }

  /**
   * Expone el hash SOLO para que AuthService lo compare con bcrypt.
   * Nunca serializar esto en respuestas HTTP.
   */
  getPasswordHash(): string {
    return this.state.passwordHash;
  }

  assertActive(): void {
    if (!this.state.isActive) {
      throw new BusinessRuleError(
        'USER_INACTIVE',
        'This account has been deactivated',
        { userId: this.state.id },
      );
    }
  }

  recordLogin(): User {
    return User.hydrate({ ...this.state, lastLoginAt: new Date() });
  }

  toPublicProfile(): UserPublicProfile {
    return {
      id: this.state.id,
      tenantId: this.state.tenantId,
      email: this.state.email,
      fullName: this.state.fullName,
      role: this.state.role,
    };
  }
}

export interface UserPublicProfile {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: UserRole;
}

// ---------------------------------------------------------------------------
// Payload embebido en el JWT
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string;        // userId
  tenantId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}


