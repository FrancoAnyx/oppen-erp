import { Module, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './application/auth.service';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { JwtAuthGuard } from './infrastructure/guards';
import { AuthController } from './interfaces/http/auth.controller';
import type { AppConfig } from '../../config/app.config';

/**
 * AuthModule — @Global() para que JwtAuthGuard esté disponible en toda la app.
 *
 * Por qué @Global():
 *   - JwtAuthGuard se registra como APP_GUARD (aplicado a TODOS los endpoints).
 *   - Sin @Global(), otros módulos no pueden resolver JwtAuthGuard como dep.
 *   - AuthService se exporta para que otros módulos puedan hashear passwords
 *     si necesitan crear usuarios (ej: un futuro UserManagementModule).
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Guard global: aplica a todos los endpoints.
    // Endpoints con @Public() son excluidos dentro del guard.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}

