import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '@erp/shared';
import { Prisma } from '@erp/database';

/**
 * Filter global que captura TODOS los errores no manejados y los convierte
 * a un formato HTTP consistente.
 *
 * Formato de response:
 *   {
 *     error: {
 *       code: string,           // Estable, mapeable a i18n
 *       message: string,        // Human-readable, puede cambiar
 *       httpStatus: number,
 *       context?: object,       // Datos de debugging (SOLO en dev)
 *       requestId?: string,     // Para correlación con logs
 *       timestamp: string
 *     }
 *   }
 *
 * Orden de prioridad:
 *   1. DomainError     → usar sus propias code/httpStatus
 *   2. HttpException   → Nest standard (ej: validación class-validator)
 *   3. Prisma errors   → traducir a errores genéricos
 *   4. Unknown         → 500 genérico, pero LOGGEAR TODO
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { httpStatus, payload, logLevel } = this.resolveError(exception);

    // Logging estructurado. Incluimos el path para correlación.
    const logContext = {
      method: request.method,
      path: request.url,
      statusCode: httpStatus,
      errorCode: payload.code,
    };

    if (logLevel === 'error') {
      this.logger.error(
        `${payload.code}: ${payload.message}`,
        exception instanceof Error ? exception.stack : undefined,
        logContext,
      );
    } else if (logLevel === 'warn') {
      this.logger.warn(`${payload.code}: ${payload.message}`, logContext);
    } else {
      this.logger.debug(`${payload.code}: ${payload.message}`, logContext);
    }

    // En producción ocultamos context (puede tener data sensible)
    const clientPayload = this.isProduction
      ? { ...payload, context: undefined, stack: undefined }
      : payload;

    response.status(httpStatus).json({
      error: {
        ...clientPayload,
        timestamp: new Date().toISOString(),
      },
    });
  }

  private resolveError(exception: unknown): {
    httpStatus: number;
    payload: {
      code: string;
      message: string;
      httpStatus: number;
      context?: Record<string, unknown>;
      stack?: string;
    };
    logLevel: 'error' | 'warn' | 'debug';
  } {
    // ---- 1. DomainError: nuestros errores tipados ----
    if (exception instanceof DomainError) {
      const json = exception.toJSON();
      return {
        httpStatus: json.httpStatus,
        payload: {
          code: json.code,
          message: json.message,
          httpStatus: json.httpStatus,
          context: json.context,
          stack: exception.stack,
        },
        logLevel:
          json.severity === 'critical' || json.severity === 'error'
            ? 'error'
            : json.severity === 'warning'
            ? 'warn'
            : 'debug',
      };
    }

    // ---- 2. Nest HttpException (class-validator, guards, etc) ----
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : (res as { message?: string | string[] }).message?.toString() ??
            exception.message;

      return {
        httpStatus: status,
        payload: {
          code: this.httpStatusToCode(status),
          message: Array.isArray(message) ? message.join('; ') : message,
          httpStatus: status,
          context: typeof res === 'object' ? (res as Record<string, unknown>) : undefined,
        },
        logLevel: status >= 500 ? 'error' : 'debug',
      };
    }

    // ---- 3. Prisma errors: los más comunes ----
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        httpStatus: HttpStatus.BAD_REQUEST,
        payload: {
          code: 'PRISMA_VALIDATION',
          message: 'Invalid database query parameters',
          httpStatus: HttpStatus.BAD_REQUEST,
          context: { raw: exception.message },
        },
        logLevel: 'error',
      };
    }

    // ---- 4. Error genérico o desconocido ----
    const error = exception instanceof Error ? exception : new Error(String(exception));
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      payload: {
        code: 'INTERNAL_SERVER_ERROR',
        message: this.isProduction ? 'Internal server error' : error.message,
        httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
        stack: error.stack,
      },
      logLevel: 'error',
    };
  }

  private resolvePrismaError(err: Prisma.PrismaClientKnownRequestError): ReturnType<
    DomainExceptionFilter['resolveError']
  > {
    switch (err.code) {
      case 'P2002': {
        // Unique constraint violation
        const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'unknown';
        return {
          httpStatus: HttpStatus.CONFLICT,
          payload: {
            code: 'UNIQUE_CONSTRAINT_VIOLATION',
            message: `Duplicate value for: ${target}`,
            httpStatus: HttpStatus.CONFLICT,
            context: { target },
          },
          logLevel: 'debug',
        };
      }
      case 'P2025': {
        // Record not found
        return {
          httpStatus: HttpStatus.NOT_FOUND,
          payload: {
            code: 'NOT_FOUND',
            message: 'Record not found',
            httpStatus: HttpStatus.NOT_FOUND,
          },
          logLevel: 'debug',
        };
      }
      case 'P2003': {
        // Foreign key violation
        return {
          httpStatus: HttpStatus.CONFLICT,
          payload: {
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Referenced record does not exist',
            httpStatus: HttpStatus.CONFLICT,
            context: { field: err.meta?.field_name },
          },
          logLevel: 'warn',
        };
      }
      case 'P2034': {
        // Serializable transaction conflict — retryable
        return {
          httpStatus: HttpStatus.CONFLICT,
          payload: {
            code: 'CONCURRENCY_CONFLICT',
            message: 'Transaction conflict, please retry',
            httpStatus: HttpStatus.CONFLICT,
          },
          logLevel: 'warn',
        };
      }
      default:
        return {
          httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
          payload: {
            code: `PRISMA_${err.code}`,
            message: 'Database error',
            httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
            context: { meta: err.meta },
          },
          logLevel: 'error',
        };
    }
  }

  private httpStatusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? `HTTP_${status}`;
  }
}
