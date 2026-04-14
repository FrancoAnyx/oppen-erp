export class EmitInvoiceDto {
  salesOrderId!: string;
  invoiceType!: number;
  posNumber?: number;
  recipientCuit?: string;
  lines!: Array<{
    description: string;
    quantity: number;
    uom?: string;
    unitPriceArs: number;
    discountPct?: number;
    ivaRate: number;
    salesOrderLineId?: string;
  }>;
}
