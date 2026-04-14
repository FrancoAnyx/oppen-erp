/**
 * Payload del JWT firmado por öppen ERP.
 * sub = userId, tenantId para multi-tenant, role para RBAC.
 */
export interface JwtPayload {
  /** User ID */
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  iat?: number;
  exp?: number;
}
