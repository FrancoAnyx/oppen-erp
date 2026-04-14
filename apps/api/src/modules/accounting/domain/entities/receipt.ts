import { BusinessRuleError, ValidationError } from '@erp/shared';

export type ReceiptType  = 'COBRO' | 'PAGO';
export type ReceiptState = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface ReceiptProps {
  id: string; tenantId: string; receiptType: ReceiptType; entityId: string;
  description?: string; amountArs: string; currency: string; fxRate: string;
  paymentMethod: string; bankAccountId?: string; state: ReceiptState;
  version: number; createdById: string; confirmedAt?: Date; createdAt: Date; updatedAt: Date;
}

export class Receipt {
  private constructor(private state: ReceiptProps) {}

  static create(props: Omit<ReceiptProps,'id'|'state'|'version'|'createdAt'|'updatedAt'>): Receipt {
    if (Number(props.amountArs) <= 0) throw new ValidationError('Receipt amount must be positive');
    return new Receipt({ ...props, id: '', state: 'DRAFT', version: 1, createdAt: new Date(), updatedAt: new Date() });
  }

  static reconstitute(props: ReceiptProps): Receipt { return new Receipt(props); }

  confirm(): void {
    if (this.state.state !== 'DRAFT') throw new BusinessRuleError('RECEIPT_NOT_DRAFT', `Cannot confirm receipt in state ${this.state.state}`);
    this.state.state = 'CONFIRMED'; this.state.confirmedAt = new Date(); this.state.updatedAt = new Date();
  }

  cancel(): void {
    if (this.state.state === 'CONFIRMED') throw new BusinessRuleError('RECEIPT_ALREADY_CONFIRMED', 'Cannot cancel a confirmed receipt');
    this.state.state = 'CANCELLED'; this.state.updatedAt = new Date();
  }

  toProps(): ReceiptProps { return { ...this.state }; }
  get id(): string { return this.state.id; }
  set id(v: string) { this.state.id = v; }
  get currentState(): ReceiptState { return this.state.state; }
  get version(): number { return this.state.version; }
}
