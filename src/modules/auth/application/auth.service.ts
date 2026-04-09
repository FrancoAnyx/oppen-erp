// ============================================================
// src/modules/auth/application/auth.service.ts
// ============================================================

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../core/infrastructure/persistence/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UserRole, UserStatus, UserEntity, ROLE_PERMISSIONS } from '../domain/entities/user.entity';

// ─────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────
export interface LoginDto {
  email: string;
  password: string;
}

export interface InviteUserDto {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface ActivateAccountDto {
  token: string;
  password: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface JwtPayload {
  sub: string;          // user.id
  tenantId: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────
@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 12;
  private readonly INVITE_TOKEN_TTL_HOURS = 72;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ──────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────
  async login(dto: LoginDto): Promise<AuthTokens & { user: object }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (!user || user.status === UserStatus.SUSPENDED) {
      // Tiempo constante para evitar timing attacks
      await bcrypt.compare(dto.password, '$2b$12$invalidhashpadding000000000000000000000000000000000000');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.status === UserStatus.PENDING_ACTIVATION) {
      throw new UnauthorizedException('La cuenta no fue activada. Revisá el email de invitación.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      await this.prisma.auditLog.create({
        data: {
          tenantId: user.tenantId,
          entityType: 'USER',
          entityId: user.id,
          action: 'LOGIN_FAILED',
          userId: user.id,
          metadata: { ip: 'unknown', reason: 'bad_password' },
        },
      });
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // Actualizar lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        entityType: 'USER',
        entityId: user.id,
        action: 'LOGIN_SUCCESS',
        userId: user.id,
        metadata: {},
      },
    });

    const tokens = await this.generateTokens(user);
    const entity = new UserEntity(user as any);

    return { ...tokens, user: entity.toJSON() };
  }

  // ──────────────────────────────────────────
  // INVITE USER (solo ADMIN)
  // ──────────────────────────────────────────
  async inviteUser(
    dto: InviteUserDto,
    invitedBy: JwtPayload,
  ): Promise<{ message: string; inviteToken: string }> {
    const inviter = await this.prisma.user.findUnique({ where: { id: invitedBy.sub } });
    if (!inviter || inviter.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Solo administradores pueden invitar usuarios');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException(`El email ${dto.email} ya tiene una cuenta`);
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiresAt = new Date();
    inviteTokenExpiresAt.setHours(inviteTokenExpiresAt.getHours() + this.INVITE_TOKEN_TTL_HOURS);

    const user = await this.prisma.user.create({
      data: {
        tenantId: invitedBy.tenantId,
        email: dto.email.toLowerCase().trim(),
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        status: UserStatus.PENDING_ACTIVATION,
        passwordHash: null,
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: invitedBy.tenantId,
        entityType: 'USER',
        entityId: user.id,
        action: 'USER_INVITED',
        userId: invitedBy.sub,
        metadata: { invitedEmail: dto.email, role: dto.role },
      },
    });

    // TODO: enviar email con link de activación
    // await this.mailer.sendInvite(dto.email, inviteToken);
    const appUrl = this.config.get('APP_URL', 'http://localhost:3001');

    return {
      message: `Invitación enviada a ${dto.email}`,
      // En producción NO exponer el token en la respuesta API.
      // Solo está acá para facilitar testing. El token va por email.
      inviteToken: `${appUrl}/auth/activate?token=${inviteToken}`,
    };
  }

  // ──────────────────────────────────────────
  // ACTIVAR CUENTA (token de invitación)
  // ──────────────────────────────────────────
  async activateAccount(dto: ActivateAccountDto): Promise<AuthTokens & { user: object }> {
    this.validatePasswordStrength(dto.password);

    const user = await this.prisma.user.findFirst({
      where: { inviteToken: dto.token },
    });

    if (!user) {
      throw new BadRequestException('Token de activación inválido o ya utilizado');
    }

    const entity = new UserEntity(user as any);
    if (!entity.isInviteValid()) {
      throw new BadRequestException('El token de activación expiró. Solicitá una nueva invitación.');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: UserStatus.ACTIVE,
        inviteToken: null,
        inviteTokenExpiresAt: null,
        lastLoginAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        entityType: 'USER',
        entityId: user.id,
        action: 'ACCOUNT_ACTIVATED',
        userId: user.id,
        metadata: {},
      },
    });

    const tokens = await this.generateTokens(updated);
    const updatedEntity = new UserEntity(updated as any);

    return { ...tokens, user: updatedEntity.toJSON() };
  }

  // ──────────────────────────────────────────
  // CAMBIAR CONTRASEÑA
  // ──────────────────────────────────────────
  async changePassword(dto: ChangePasswordDto, currentUser: JwtPayload): Promise<{ message: string }> {
    this.validatePasswordStrength(dto.newPassword);

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser diferente a la actual');
    }

    const user = await this.prisma.user.findUnique({ where: { id: currentUser.sub } });
    if (!user || !user.passwordHash) throw new UnauthorizedException();

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Contraseña actual incorrecta');

    const passwordHash = await bcrypt.hash(dto.newPassword, this.BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        entityType: 'USER',
        entityId: user.id,
        action: 'PASSWORD_CHANGED',
        userId: user.id,
        metadata: {},
      },
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  // ──────────────────────────────────────────
  // GET ME (perfil del usuario autenticado)
  // ──────────────────────────────────────────
  async getMe(userId: string): Promise<object> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const entity = new UserEntity(user as any);
    return {
      ...entity.toJSON(),
      permissions: ROLE_PERMISSIONS[user.role as UserRole] ?? [],
    };
  }

  // ──────────────────────────────────────────
  // LISTAR USUARIOS (solo ADMIN)
  // ──────────────────────────────────────────
  async listUsers(tenantId: string): Promise<object[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => new UserEntity(u as any).toJSON());
  }

  // ──────────────────────────────────────────
  // SUSPENDER USUARIO
  // ──────────────────────────────────────────
  async suspendUser(userId: string, adminUser: JwtPayload): Promise<void> {
    if (userId === adminUser.sub) {
      throw new BadRequestException('No podés suspender tu propia cuenta');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.tenantId !== adminUser.tenantId) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: adminUser.tenantId,
        entityType: 'USER',
        entityId: userId,
        action: 'USER_SUSPENDED',
        userId: adminUser.sub,
        metadata: {},
      },
    });
  }

  // ──────────────────────────────────────────
  // REFRESH TOKEN
  // ──────────────────────────────────────────
  async refreshToken(token: string): Promise<AuthTokens> {
    try {
      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: this.config.get('JWT_SECRET'),
      });

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException();
      }

      return this.generateTokens(user);
    } catch {
      throw new UnauthorizedException('Token de refresh inválido o expirado');
    }
  }

  // ──────────────────────────────────────────
  // HELPERS PRIVADOS
  // ──────────────────────────────────────────
  private async generateTokens(user: any): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const expiresIn = parseInt(
      this.config.get('JWT_EXPIRES_IN', '28800'), // 8 horas en segundos
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn,
      }),
      this.jwt.signAsync({ sub: user.id }, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);

    return { accessToken, refreshToken, expiresIn };
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('La contraseña debe tener al menos una mayúscula');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('La contraseña debe tener al menos un número');
    }
  }
}
