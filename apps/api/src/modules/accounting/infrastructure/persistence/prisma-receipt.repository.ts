import { Injectable } from '@nestjs/common';
import { ConcurrencyError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { IReceiptRepository } from '../../domain/repositories/accounting.repositories';
import { Receipt, type ReceiptProps } from '../../domain/entities/receipt';

@Injectable()
export class PrismaReceiptRepository implements IReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<Receipt | null> {
    const row = await this.prisma.receipt.findFirst({ where: { id, tenantId } });
    return row ? Receipt.reconstitute(this.map(row)) : null;
  }

  async findMany(p: any) {
    const where: any = { tenantId: p.tenantId };
    if (p.entityId) where.entityId = p.entityId;
    if (p.state)    where.state    = p.state;
    const [rows, total] = await Promise.all([
      this.prisma.receipt.findMany({ where, skip: p.skip ?? 0, take: p.take ?? 20, orderBy: { createdAt: 'desc' } }),
      this.prisma.receipt.count({ where }),
    ]);
    return { items: rows.map((r: any) => Receipt.reconstitute(this.map(r))), total };
  }

  async create(receipt: Receipt): Promise<Receipt> {
    const p = receipt.toProps();
    const row = await this.prisma.receipt.create({ data: {
      tenantId: p.tenantId, receiptType: p.receiptType as any, entityId: p.entityId,
      description: p.description, amountArs: p.amountArs, currency: p.currency,
      fxRate: p.fxRate, paymentMethod: p.paymentMethod, bankAccountId: p.bankAccountId,
      state: p.state as any, version: 1, createdById: p.createdById,
    }});
    return Receipt.reconstitute(this.map(row));
  }

  async update(receipt: Receipt): Promise<Receipt> {
    const p = receipt.toProps();
    const result = await this.prisma.receipt.updateMany({
      where: { id: p.id, tenantId: p.tenantId, version: p.version },
      data: { state: p.state as any, confirmedAt: p.confirmedAt, version: { increment: 1 } },
    });
    if (result.count === 0) throw new ConcurrencyError('Receipt', p.id, p.version);
    return this.findById(p.tenantId, p.id) as Promise<Receipt>;
  }

  async getEntityBalance(tenantId: string, entityId: string) {
    const result = await this.prisma.receipt.groupBy({
      by: ['receiptType'], where: { tenantId, entityId, state: 'CONFIRMED' }, _sum: { amountArs: true },
    });
    let balance = 0;
    for (const r of result) {
      const amt = Number((r as any)._sum.amountArs ?? 0);
      balance += (r as any).receiptType === 'COBRO' ? amt : -amt;
    }
    return { balance: balance.toFixed(2), currency: 'ARS' };
  }

  private map(row: any): ReceiptProps {
    return { id: row.id, tenantId: row.tenantId, receiptType: row.receiptType,
      entityId: row.entityId, description: row.description ?? undefined,
      amountArs: row.amountArs.toString(), currency: row.currency, fxRate: row.fxRate.toString(),
      paymentMethod: row.paymentMethod, bankAccountId: row.bankAccountId ?? undefined,
      state: row.state, version: row.version, createdById: row.createdById,
      confirmedAt: row.confirmedAt ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}
