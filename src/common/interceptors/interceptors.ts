// ============================================================
// src/common/interceptors/transform.interceptor.ts
// Envuelve respuestas exitosas en un envelope consistente
// ============================================================

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ResponseEnvelope<T> {
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResponseEnvelope<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseEnvelope<T>> {
    return next.handle().pipe(
      map((data) => ({
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}


// ============================================================
// src/common/interceptors/logging.interceptor.ts
// Logging estructurado de cada request con timing
// ============================================================

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Agregar request ID para correlación de logs
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);

    const startTime = Date.now();
    const { method, url } = req;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const status = res.statusCode;
          this.logger.log(`${method} ${url} → ${status} [${duration}ms] [${requestId}]`);
        },
        error: (err) => {
          const duration = Date.now() - startTime;
          this.logger.error(`${method} ${url} → ERROR [${duration}ms] [${requestId}]: ${err.message}`);
        },
      }),
    );
  }
}


// ============================================================
// src/common/interceptors/tenant.interceptor.ts
// Extrae tenantId del JWT y lo inyecta en req para uso en repos
// ============================================================

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DEFAULT_TENANT_ID } from '@erp/shared';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = this.jwt.verify<{ tenantId: string }>(token, {
          secret: this.config.get('JWT_SECRET'),
        });
        (req as any).tenantId = payload.tenantId ?? DEFAULT_TENANT_ID;
      } catch {
        (req as any).tenantId = DEFAULT_TENANT_ID;
      }
    } else {
      // Rutas públicas (health, docs) usan el tenant default
      (req as any).tenantId = DEFAULT_TENANT_ID;
    }

    return next.handle();
  }
}


// ============================================================
// src/common/guards/throttler-proxy.guard.ts
// Rate limiter que respeta X-Forwarded-For detrás de nginx
// ============================================================

import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Usar la IP real del cliente, no la del proxy
    return (
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown'
    );
  }

  // Solo aplica throttling en rutas de auth
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const isAuthRoute = req.url?.includes('/auth/');
    // Throttle estricto en auth, saltar en el resto (manejado por nginx)
    return !isAuthRoute;
  }
}
