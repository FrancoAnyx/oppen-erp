import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { BusinessRuleError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { User, type JwtPayload, type UserRole } from '../domain/entities/user.entity';
import type { AppConfig } from '../../../config/app.config';

export interface LoginCommand {
  tenantId: string;
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

/**
 * AuthService — autenticación por email/password + emisión de JWT.
 *
 * Decisiones de diseño:
 *   - bcrypt con cost factor 12 (balance seguridad/perf para B2B interno)
 *   - JWT stateless: no hay blacklist. Para logout, el cliente descarta el token.
 *     Si se necesita revocación inmediata (cuentas comprometidas), agregar
 *     una tabla de token_revocations con TTL = expiresIn.
 *   - El tenantId va en el JWT para que el middleware lo lea sin ir a DB.
 *   - Los errores de autenticación son SIEMPRE el mismo mensaje genérico
 *     para no filtrar si el email existe o no (timing-safe también sería ideal,
 *     pero para B2B interno esto es suficiente).
 *
 * Sobre el seed de dev: el seed usa sha256 con prefijo "seed$" para no
 * requerir bcrypt en tiempo de seed. AuthService detecta ese prefijo y
 * hace comparación directa (SOLO EN DEV). En prod, todo pasa por bcrypt.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async login(cmd: LoginCommand): Promise<LoginResult> {
    // ---- 1. Buscar usuario ----
    const userRow = await this.prisma.user.findFirst({
      where: {
        tenantId: cmd.tenantId,
        email: cmd.email.toLowerCase().trim(),
      },
    });

    const GENERIC_ERROR = new BusinessRuleError(
      'INVALID_CREDENTIALS',
      'Invalid email or password',
      // No incluir email en el context — se loguea aparte
    );

    if (!userRow) {
      // Consumir tiempo similar a bcrypt para evitar timing attacks
      await bcrypt.compare('dummy', '$2b$12$dummyhashfortimingsafety000000000000000000000');
      throw GENERIC_ERROR;
    }

    const user = User.hydrate({
      id: userRow.id,
      tenantId: userRow.tenantId,
      email: userRow.email,
      passwordHash: userRow.passwordHash,
      fullName: userRow.fullName,
      role: userRow.role as UserRole,
      isActive: userRow.isActive,
      lastLoginAt: userRow.lastLoginAt ?? undefined,
      createdAt: userRow.createdAt,
      updatedAt: userRow.updatedAt,
    });

    // ---- 2. Verificar cuenta activa ----
    try {
      user.assertActive();
    } catch {
      this.logger.warn(`Login attempt for inactive user: ${cmd.email}`);
      throw GENERIC_ERROR;
    }

    // ---- 3. Verificar password ----
    const isValid = await this.verifyPassword(cmd.password, user.getPasswordHash());
    if (!isValid) {
      this.logger.warn(`Failed login attempt for user: ${cmd.email} (tenant: ${cmd.tenantId})`);
      throw GENERIC_ERROR;
    }

    // ---- 4. Actualizar lastLoginAt (fire and forget — no bloquea el login) ----
    this.prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch((err: unknown) => {
        this.logger.error('Failed to update lastLoginAt', err);
      });

    // ---- 5. Emitir JWT ----
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const expiresIn = this.config.get('JWT_EXPIRES_IN', { infer: true });
    const accessToken = this.jwtService.sign(payload);

    this.logger.log(`Login successful: ${user.email} (${user.role})`);

    return {
      accessToken,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async hashPassword(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, this.BCRYPT_ROUNDS);
  }

  /**
   * Verifica password contra hash bcrypt.
   * También maneja el hash de seed (prefijo "seed$" + sha256) — SOLO DEV.
   */
  private async verifyPassword(plain: string, hash: string): Promise<boolean> {
    // Seed hash: "seed$<sha256>" — solo en entornos no-production
    if (
      hash.startsWith('seed$') &&
      this.config.get('NODE_ENV', { infer: true }) !== 'production'
    ) {
      const { createHash } = await import('node:crypto');
      const expected = 'seed$' + createHash('sha256').update(plain).digest('hex');
      return expected === hash;
    }

    return bcrypt.compare(plain, hash);
  }
}


