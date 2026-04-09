// ============================================================
// src/common/filters/domain-exception.filter.ts
// Convierte DomainError (dominio) → respuesta HTTP estructurada
// ============================================================

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError, ErrorSeverity } from '@erp/shared';
import { Prisma } from '@prisma/client';

interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
  requestId?: string;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx  = host.switchToHttp();
    const req  = ctx.getRequest<Request>();
    const res  = ctx.getResponse<Response>();

    const { statusCode, code, message, details } =
      this.resolveError(exception);

    const body: ErrorResponse = {
      statusCode,
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: req.url,
      requestId: req.headers['x-request-id'] as string,
    };

    // Logear solo errores no esperados (5xx)
    if (statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${statusCode} ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (statusCode >= 400) {
      this.logger.warn(`${req.method} ${req.url} → ${statusCode} ${code}: ${message}`);
    }

    res.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    // 1. Errores de dominio propios
    if (exception instanceof DomainError) {
      return {
        statusCode: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // 2. HttpException de NestJS (ValidationPipe, etc.)
    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      const message =
        typeof resp === 'object' && 'message' in (resp as object)
          ? (resp as any).message
          : exception.message;

      return {
        statusCode: exception.getStatus(),
        code: 'HTTP_EXCEPTION',
        message: Array.isArray(message) ? message.join('; ') : String(message),
      };
    }

    // 3. Errores de Prisma
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Error de validación en la base de datos',
      };
    }

    // 4. Error genérico
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
    };
  }

  private handlePrismaError(err: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    switch (err.code) {
      case 'P2002': // Unique constraint
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'DUPLICATE_ENTRY',
          message: 'Ya existe un registro con esos datos',
          details: { fields: (err.meta as any)?.target },
        };

      case 'P2025': // Record not found
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'RECORD_NOT_FOUND',
          message: 'Registro no encontrado',
        };

      case 'P2003': // Foreign key constraint
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'FOREIGN_KEY_VIOLATION',
          message: 'No se puede eliminar: el registro está siendo referenciado',
        };

      case 'P2034': // Optimistic concurrency / write conflict
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'OPTIMISTIC_LOCK_FAILED',
          message: 'El registro fue modificado por otro proceso. Reintentá la operación.',
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: `DB_ERROR_${err.code}`,
          message: 'Error de base de datos',
        };
    }
  }
}
