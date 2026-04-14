import type { Invoice } from '../entities/invoice';

export interface FindManyInvoicesFilter {
  tenantId: string;
  state?: string;
  salesOrderId?: string;
  skip?: number;
  take?: number;
}

export interface AppendArcaLogParams {
  tenantId: string;
  invoiceId: string;
  attempt: number;
  method: string;
  requestXml: string;
  responseXml?: string;
  resultCode?: string;
  errorCode?: string;
  errorMsg?: string;
  durationMs?: number;
}

export interface IInvoiceRepository {
  findById(tenantId: string, id: string): Promise<Invoice | null>;
  findBySalesOrder(tenantId: string, salesOrderId: string): Promise<Invoice[]>;
  findMany(filter: FindManyInvoicesFilter): Promise<{ items: Invoice[]; total: number }>;
  create(invoice: Invoice): Promise<Invoice>;
  update(invoice: Invoice): Promise<Invoice>;
  appendArcaLog(log: AppendArcaLogParams): Promise<void>;
}

export const INVOICE_REPOSITORY = Symbol('IInvoiceRepository');
export const WSFE_SERVICE = Symbol('IWsfeService');
