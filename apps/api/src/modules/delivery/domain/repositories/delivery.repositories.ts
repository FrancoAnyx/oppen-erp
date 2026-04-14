import type { DeliveryNote } from '../entities/delivery-note';

export interface FindManyDeliveryNotesFilter {
  tenantId: string;
  salesOrderId?: string;
  state?: string;
  skip?: number;
  take?: number;
}

export interface IDeliveryNoteRepository {
  findById(tenantId: string, id: string): Promise<DeliveryNote | null>;
  findBySalesOrder(tenantId: string, salesOrderId: string): Promise<DeliveryNote[]>;
  /** Entrega activas (no CANCELLED) para una OV — usado para calcular pendientes */
  findActiveBySalesOrder(tenantId: string, salesOrderId: string): Promise<DeliveryNote[]>;
  findMany(filter: FindManyDeliveryNotesFilter): Promise<{ items: DeliveryNote[]; total: number }>;
  nextDeliveryNumber(tenantId: string): Promise<number>;
  create(note: DeliveryNote): Promise<DeliveryNote>;
  update(note: DeliveryNote): Promise<DeliveryNote>;
}

export const DELIVERY_NOTE_REPOSITORY = Symbol('IDeliveryNoteRepository');
