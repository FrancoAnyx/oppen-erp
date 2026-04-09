import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { JwtPayload, UserRole } from '../domain/entities/user.entity';

// ---------------------------------------------------------------------------
// Metadata keys
// ---------------------------------------------------------------------------

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

// ---------------------------------------------------------------------------
// Decoradores de controller/handler
// ---------------------------------------------------------------------------

/**
 * Marca un endpoint como público (no requiere JWT).
 * Usado por POST /auth/login.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restringe un endpoint a usuarios con ciertos roles.
 * Ej: @Roles('ADMIN', 'MANAGER')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Extrae el usuario autenticado del request en un controller.
 *
 * Uso:
 *   @Get('me')
 *   getMe(@CurrentUser() user: JwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    if (!request.user) {
      throw new UnauthorizedException('No authenticated user in request');
    }
    return request.user;
  },
);

// ---------------------------------------------------------------------------
// JwtAuthGuard — guard global que aplica a todos los endpoints
// ---------------------------------------------------------------------------

/**
 * Guard global que valida el JWT en todos los endpoints EXCEPTO los
 * marcados con @Public().
 *
 * Se registra como APP_GUARD en AuthModule para aplicar globalmente.
 * Esto es más seguro que opt-in: el default es "protegido", no "público".
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    // Si el handler o la clase está marcada con @Public(), saltear validación
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }

  override handleRequest<T extends JwtPayload>(err: Error | null, user: T | false): T {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentication required');
    }
    return user;
  }
}

// ---------------------------------------------------------------------------
// RolesGuard — guard opcional para control de acceso por rol
// ---------------------------------------------------------------------------

/**
 * Guard que verifica roles. Solo aplica si el handler tiene @Roles(...).
 * Usar después de JwtAuthGuard (requiere que req.user ya esté seteado).
 *
 * Ejemplo de uso en controller:
 *   @UseGuards(RolesGuard)
 *   @Roles('ADMIN')
 *   @Delete(':id')
 *   remove() { ... }
 */
@Injectable()
export class RolesGuard {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin @Roles() → el endpoint solo requiere autenticación, no rol específico
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const user = request.user;

    if (!user) return false;

    return requiredRoles.includes(user.role as UserRole);
  }
}



