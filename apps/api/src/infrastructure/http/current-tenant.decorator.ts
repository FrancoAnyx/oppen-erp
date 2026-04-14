import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Extrae el tenantId del request (inyectado por TenantInterceptor/Middleware).
 * Uso: @CurrentTenant() tenantId: string
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const req = request as any;
    return req.tenantId ?? req.user?.tenantId ?? '00000000-0000-0000-0000-000000000001';
  },
);
