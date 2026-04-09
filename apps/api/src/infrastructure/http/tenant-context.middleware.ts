import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { DEFAULT_TENANT_ID } from '@erp/shared';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    (req as any).tenantId = DEFAULT_TENANT_ID;
    next();
  }
}
