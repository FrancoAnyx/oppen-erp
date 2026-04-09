import { IsString, IsEmail, IsNotEmpty } from 'class-validator';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from '../../application/auth.service';
import { Public, CurrentUser } from '../../infrastructure/guards';
import type { JwtPayload } from '../../domain/entities/user.entity';

// ---------------------------------------------------------------------------
// DTO inline (simple — no justifica archivo separado para 2 campos)
// ---------------------------------------------------------------------------

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * AuthController — endpoints de autenticación.
 *
 * POST /auth/login → devuelve JWT
 * GET  /auth/me    → devuelve perfil del usuario autenticado (útil para UI)
 *
 * El tenantId viene del TenantContextMiddleware (header X-Tenant-ID o default).
 * En single-tenant esto siempre es DEFAULT_TENANT_ID.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    // TenantContextMiddleware ya lo inyecta en req.tenantId
    // Lo leemos directo del request para no depender del decorator de tenant
  ): Promise<ReturnType<AuthService['login']>> {
    // En single-tenant el tenantId viene del middleware.
    // Para login necesitamos el tenantId ANTES de autenticar, así que
    // el middleware lo provee desde el header o el DEFAULT_TENANT_ID.
    // Usamos el truquito de req via ExecutionContext — pero más limpio
    // es inyectarlo en el método con @CurrentTenant si el middleware corre.
    // Como login es @Public, el TenantContextMiddleware SI corre (es middleware,
    // no guard), así que @CurrentTenant funciona.
    const { DEFAULT_TENANT_ID } = await import('@erp/shared');
    return this.authService.login({
      tenantId: DEFAULT_TENANT_ID,
      email: dto.email,
      password: dto.password,
    });
  }

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return {
      id: user.sub,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };
  }
}





