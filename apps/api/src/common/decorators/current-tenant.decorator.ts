import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DEFAULT_TENANT_ID } from '@erp/shared';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<{ user?: { tenantId?: string }; tenantId?: string }>();
    return (request as any).tenantId ?? request.user?.tenantId ?? DEFAULT_TENANT_ID;
  },
);
