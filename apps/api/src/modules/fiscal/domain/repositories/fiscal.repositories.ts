import type { Invoice } from '../entities/invoice';

export interface FindManyInvoicesFilter {
  tenantId: string;
  state?: string;
  salesOrderId?: string;
  skip?: number;
  take?: number;
}

export interface IInvoiceRepository {
  findById(tenantId: string, id: string): Promise<Invoice | null>;
  findMany(filter: FindManyInvoicesFilter): Promise<{ items: Invoice[]; total: number }>;
  create(invoice: Invoice): Promise<Invoice>;
  update(invoice: Invoice): Promise<Invoice>;
}

export const INVOICE_REPOSITORY = Symbol('IInvoiceRepository');
export const WSFE_SERVICE = Symbol('IWsfeService');
