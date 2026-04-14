import { Injectable, Inject } from '@nestjs/common';
import { NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { Receipt } from '../../domain/entities/receipt';
import { IReceiptRepository, RECEIPT_REPOSITORY } from '../../domain/repositories/accounting.repositories';

export interface CreateReceiptCommand {
  tenantId: string; createdById: string; receiptType: 'COBRO'|'PAGO';
  entityId: string; description?: string; amountArs: string;
  currency?: string; fxRate?: string; paymentMethod: string; bankAccountId?: string;
}

@Injectable()
export class CreateReceiptUseCase {
  constructor(
    @Inject(RECEIPT_REPOSITORY) private readonly repo: IReceiptRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreateReceiptCommand): Promise<{ id: string; state: string }> {
    const entity = await this.prisma.entity.findFirst({ where: { id: cmd.entityId, tenantId: cmd.tenantId } });
    if (!entity) throw new NotFoundError('Entity', cmd.entityId);
    const receipt = Receipt.create({ tenantId: cmd.tenantId, receiptType: cmd.receiptType, entityId: cmd.entityId,
      description: cmd.description, amountArs: cmd.amountArs, currency: cmd.currency ?? 'ARS',
      fxRate: cmd.fxRate ?? '1', paymentMethod: cmd.paymentMethod, bankAccountId: cmd.bankAccountId, createdById: cmd.createdById });
    const saved = await this.repo.create(receipt);
    return { id: saved.id, state: saved.currentState };
  }
}
