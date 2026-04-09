/**
 * Sistema de errores de dominio del ERP.
 *
 * Filosofía: nunca usar `throw new Error(...)` en código de dominio o aplicación.
 * Cada error es una clase que extiende DomainError con:
 *   - code:       string estable (snake_case en MAYÚSCULAS) que el frontend puede mapear a i18n
 *   - httpStatus: status HTTP sugerido (un filter en la capa HTTP lo aplica)
 *   - severity:   para routing de logs / alertas
 *   - context:    payload arbitrario para debugging (NO incluir secretos)
 *
 * Estos errores son SERIALIZABLES (toJSON) para que los workers de BullMQ los
 * persistan en la cola sin perder estructura.
 */

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface DomainErrorJSON {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly httpStatus: number;
  readonly severity: ErrorSeverity;
  readonly context: Readonly<Record<string, unknown>>;
}

export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public abstract readonly httpStatus: number;
  public readonly severity: ErrorSeverity = 'error';
  public readonly context: Readonly<Record<string, unknown>>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.context = Object.freeze({ ...context });
    // Mantener stack trace correcto en V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): DomainErrorJSON {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      severity: this.severity,
      context: this.context,
    };
  }
}

// =====================================================
// Errores genéricos reutilizables por todos los módulos
// =====================================================

/**
 * Recurso no encontrado. El context debe incluir { resource, identifier }.
 */
export class NotFoundError extends DomainError {
  override readonly code = 'NOT_FOUND';
  override readonly httpStatus = 404;
  override readonly severity: ErrorSeverity = 'info';

  constructor(resource: string, identifier: string | number | Record<string, unknown>) {
    super(`${resource} not found`, { resource, identifier });
  }
}

/**
 * Validación fallida. Se usa cuando un Value Object no puede construirse o
 * cuando un comando llega con datos imposibles.
 */
export class ValidationError extends DomainError {
  override readonly code = 'VALIDATION_ERROR';
  override readonly httpStatus = 422;
  override readonly severity: ErrorSeverity = 'info';

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context);
  }
}

/**
 * Violación de invariante de negocio. Distinto de ValidationError porque acá
 * los datos son sintácticamente válidos pero rompen una regla del dominio
 * (ej: "no se puede confirmar una OV con líneas en cero").
 */
export class BusinessRuleError extends DomainError {
  override readonly code: string;
  override readonly httpStatus = 422;
  override readonly severity: ErrorSeverity = 'warning';

  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message, context);
    this.code = code;
  }
}

/**
 * Conflicto de concurrencia (optimistic locking falló).
 * El cliente DEBE refrescar y reintentar — nunca aplicar automáticamente.
 */
export class ConcurrencyError extends DomainError {
  override readonly code = 'CONCURRENCY_CONFLICT';
  override readonly httpStatus = 409;
  override readonly severity: ErrorSeverity = 'warning';

  constructor(resource: string, expectedVersion: number, actualVersion: number) {
    super(
      `${resource} was modified by another transaction`,
      { resource, expectedVersion, actualVersion },
    );
  }
}

/**
 * Operación no permitida en el estado actual de un agregado
 * (ej: anular una factura ya con CAE → usar nota de crédito).
 */
export class IllegalStateTransitionError extends DomainError {
  override readonly code = 'ILLEGAL_STATE_TRANSITION';
  override readonly httpStatus = 409;
  override readonly severity: ErrorSeverity = 'warning';

  constructor(
    aggregate: string,
    currentState: string,
    attemptedTransition: string,
  ) {
    super(
      `Cannot perform "${attemptedTransition}" on ${aggregate} in state "${currentState}"`,
      { aggregate, currentState, attemptedTransition },
    );
  }
}

/**
 * Recurso ya existe. Usar cuando una constraint UNIQUE falla por motivos
 * de negocio (ej: SKU duplicado).
 */
export class AlreadyExistsError extends DomainError {
  override readonly code = 'ALREADY_EXISTS';
  override readonly httpStatus = 409;
  override readonly severity: ErrorSeverity = 'info';

  constructor(resource: string, identifier: string | Record<string, unknown>) {
    super(`${resource} already exists`, { resource, identifier });
  }
}

/**
 * El usuario no tiene permiso para esta acción.
 * Distinto de Unauthorized (no autenticado).
 */
export class ForbiddenError extends DomainError {
  override readonly code = 'FORBIDDEN';
  override readonly httpStatus = 403;
  override readonly severity: ErrorSeverity = 'warning';

  constructor(action: string, resource?: string) {
    super(
      `Not allowed to ${action}${resource ? ` on ${resource}` : ''}`,
      { action, resource },
    );
  }
}

/**
 * Falla al integrar con un servicio externo (ARCA, banco, padrón).
 * Crítico porque suele requerir intervención humana.
 */
export class ExternalServiceError extends DomainError {
  override readonly code = 'EXTERNAL_SERVICE_ERROR';
  override readonly httpStatus = 502;
  override readonly severity: ErrorSeverity = 'critical';

  constructor(service: string, message: string, context: Record<string, unknown> = {}) {
    super(`[${service}] ${message}`, { service, ...context });
  }
}
