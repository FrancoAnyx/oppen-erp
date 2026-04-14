import type { DeliveryNote } from '../entities/delivery-note';

export interface IDeliveryNoteRepository {
  findById(tenantId: string, id: string): Promise<DeliveryNote | null>;
  findBySalesOrder(tenantId: string, salesOrderId: string): Promise<DeliveryNote[]>;
  create(note: DeliveryNote): Promise<DeliveryNote>;
  update(note: DeliveryNote): Promise<DeliveryNote>;
}

export const DELIVERY_NOTE_REPOSITORY = Symbol('IDeliveryNoteRepository');
