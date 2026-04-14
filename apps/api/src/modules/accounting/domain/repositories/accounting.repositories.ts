import type { Receipt } from '../entities/receipt';

export interface IReceiptRepository {
  findById(tenantId: string, id: string): Promise<Receipt | null>;
  findMany(p: { tenantId: string; entityId?: string; state?: string; skip?: number; take?: number }): Promise<{ items: Receipt[]; total: number }>;
  create(receipt: Receipt): Promise<Receipt>;
  update(receipt: Receipt): Promise<Receipt>;
  getEntityBalance(tenantId: string, entityId: string): Promise<{ balance: string; currency: string }>;
}

export const RECEIPT_REPOSITORY = Symbol('IReceiptRepository');
