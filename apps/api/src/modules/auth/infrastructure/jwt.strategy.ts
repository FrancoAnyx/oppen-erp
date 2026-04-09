import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../../config/app.config';
import type { JwtPayload } from '../domain/entities/user.entity';

/**
 * JwtStrategy — valida el Bearer token en cada request protegido.
 *
 * Agrega `req.user` con el payload del JWT. Los guards y decorators
 * downstream leen de ahí.
 *
 * NO va a la DB en cada request — el JWT es autocontenido (tenantId, role, etc).
 * Si necesitás revocar un token, hay que agregar una blacklist (Redis con TTL).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  /**
   * Llamado por Passport después de verificar la firma del JWT.
   * Lo que retorne acá se asigna a req.user.
   */
  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return payload;
  }
}

