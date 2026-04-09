import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Decorator para extraer el tenantId del request en controllers.
 *
 * Uso:
 *   @Get()
 *   findAll(@CurrentTenant() tenantId: string) { ... }
 *
 * Depende de que TenantContextMiddleware haya corrido antes. Si no, lanza.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!(request as any).tenantId) {
      throw new Error(
        'TenantContextMiddleware did not run — @CurrentTenant() used without middleware',
      );
    }
    return (request as any).tenantId;
  },
);

