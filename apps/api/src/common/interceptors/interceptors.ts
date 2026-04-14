import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, map } from 'rxjs/operators';

/**
 * LoggingInterceptor — loguea método, URL y duración de cada request.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; url: string }>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} — ${ms}ms`);
      }),
    );
  }
}

/**
 * TransformInterceptor — envuelve todas las respuestas en { data, meta }.
 * Los errores los maneja DomainExceptionFilter, no este interceptor.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, { data: T; meta: { timestamp: string } }> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: T; meta: { timestamp: string } }> {
    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { timestamp: new Date().toISOString() },
      })),
    );
  }
}
