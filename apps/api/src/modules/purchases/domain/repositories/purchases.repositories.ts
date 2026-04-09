import { PurchaseOrder } from '../entities/purchase-order';

export interface IPurchaseOrderRepository {
  findById(tenantId: string, id: string): Promise<PurchaseOrder | null>;
  findByOrderNumber(tenantId: string, orderNumber: number): Promise<PurchaseOrder | null>;

  findMany(params: {
    tenantId: string;
    supplierId?: string;
    state?: string | string[];
    soOriginId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: PurchaseOrder[]; total: number }>;

  create(po: PurchaseOrder): Promise<PurchaseOrder>;
  update(po: PurchaseOrder): Promise<PurchaseOrder>;
  nextOrderNumber(tenantId: string): Promise<number>;
}

export const PURCHASE_ORDER_REPOSITORY = Symbol('IPurchaseOrderRepository');

