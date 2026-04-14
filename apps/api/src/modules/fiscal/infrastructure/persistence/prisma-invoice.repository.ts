
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConcurrencyError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IInvoiceRepository,
  FindManyInvoicesFilter,
} from '../../domain/repositories/fiscal.repositories';
import {
  Invoice,
  InvoiceLine,
  type InvoiceProps,
  type InvoiceLineProps,
  type IvaAliquot,
} from '../../domain/entities/invoice';

type PrismaInvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

@Injectable()
export class PrismaInvoiceRepository implements IInvoiceRepository {
  private readonly logger = new Logger(PrismaInvoiceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(invoice: Invoice): Promise<Invoice> {
    const p = invoice.toProps();
    const created = await this.prisma.invoice.create({
      data: {
        tenantId: p.tenantId,
        salesOrderId: p.salesOrderId,
        posNumberId: p.posNumberId,
        posNumber: p.posNumber,
        docTypeCode: p.docTypeCode,
        docTypeDesc: p.docTypeDesc,
        recipientCuit: p.recipientCuit,
        recipientName: p.recipientName,
        recipientIva: p.recipientIva,
        invoiceDate: p.invoiceDate,
        subtotalArs: p.subtotalArs,
        ivaBreakdown: p.ivaBreakdown as any,
        totalIvaArs: p.totalIvaArs,
        totalArs: p.totalArs,
        state: p.state as any,
        isContingency: p.isContingency,
        arcaAttempts: p.arcaAttempts,
        version: 1,
        createdById: p.createdById,
        originalInvoiceId: p.originalInvoiceId ?? null,
        lines: {
          create: p.lines.map((l) => ({
            tenantId: l.tenantId,
            lineNumber: l.lineNumber,
            description: l.description,
            quantity: l.quantity,
            uom: l.uom,
            unitPriceArs: l.unitPriceArs,
            discountPct: l.discountPct,
            ivaRate: l.ivaRate,
            subtotalArs: l.subtotalArs,
            ivaArs: l.ivaArs,
            totalArs: l.totalArs,
            salesOrderLineId: l.salesOrderLineId ?? null,
          })),
        },
      },
      include: { lines: true },
    });
    return this.toDomain(created);
  }

  async update(invoice: Invoice): Promise<Invoice> {
    const p = invoice.toProps();
    const result = await this.prisma.invoice.updateMany({
      where: { id: p.id, tenantId: p.tenantId, version: p.version },
      data: {
        state: p.state as any,
        docNumber: p.docNumber ?? null,
        cae: p.cae ?? null,
        caeExpiresAt: p.caeExpiresAt ?? null,
        isContingency: p.isContingency,
        caea: p.caea ?? null,
        bullJobId: p.bullJobId ?? null,
        arcaAttempts: p.arcaAttempts,
        lastArcaError: p.lastArcaError ?? null,
        pdfPath: p.pdfPath ?? null,
        approvedAt: p.approvedAt ?? null,
        failedAt: p.failedAt ?? null,
        voidedAt: p.voidedAt ?? null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const exists = await this.prisma.invoice.findUnique({
        where: { id: p.id },
        select: { version: true },
      });
      if (!exists) throw new NotFoundError('Invoice', p.id);
      throw new ConcurrencyError('Invoice', p.version, exists.version);
    }

    const updated = await this.prisma.invoice.findUniqueOrThrow({
      where: { id: p.id },
      include: { lines: true },
    });
    return this.toDomain(updated);
  }

  async findById(tenantId: string, id: string): Promise<Invoice | null> {
    const row = await this.prisma.invoice.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    return row ? this.toDomain(row) : null;
  }

  async findBySalesOrder(tenantId: string, salesOrderId: string): Promise<Invoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { tenantId, salesOrderId },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findMany(
    filter: FindManyInvoicesFilter,
  ): Promise<{ items: Invoice[]; total: number }> {
    const where: Prisma.InvoiceWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.salesOrderId && { salesOrderId: filter.salesOrderId }),
      ...(filter.state && { state: filter.state as any }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip ?? 0,
        take: filter.take ?? 50,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  async appendArcaLog(log: Parameters<IInvoiceRepository['appendArcaLog']>[0]): Promise<void> {
    try {
      await this.prisma.arcaLog.create({
        data: {
          tenantId: log.tenantId,
          invoiceId: log.invoiceId,
          attempt: log.attempt,
          method: log.method,
          requestXml: log.requestXml,
          responseXml: log.responseXml ?? null,
          resultCode: log.resultCode ?? null,
          errorCode: log.errorCode ?? null,
          errorMsg: log.errorMsg ?? null,
          durationMs: log.durationMs ?? null,
        },
      });
    } catch (err) {
      // Degradación silenciosa — no fallar la factura por fallo de log
      this.logger.error(`Failed to append ArcaLog for invoice ${log.invoiceId}`, err);
    }
  }

  private toDomain(row: PrismaInvoiceWithLines): Invoice {
    const lines = row.lines.map((l) =>
      InvoiceLine.hydrate({
        id: l.id,
        tenantId: l.tenantId,
        invoiceId: l.invoiceId,
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity.toString(),
        uom: l.uom,
        unitPriceArs: l.unitPriceArs.toString(),
        discountPct: l.discountPct.toString(),
        ivaRate: l.ivaRate.toString(),
        subtotalArs: l.subtotalArs.toString(),
        ivaArs: l.ivaArs.toString(),
        totalArs: l.totalArs.toString(),
        salesOrderLineId: l.salesOrderLineId ?? undefined,
        createdAt: l.createdAt,
      } as InvoiceLineProps),
    );

    return Invoice.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      salesOrderId: row.salesOrderId,
      posNumberId: row.posNumberId,
      posNumber: row.posNumber,
      docTypeCode: row.docTypeCode,
      docTypeDesc: row.docTypeDesc,
      docNumber: row.docNumber ?? undefined,
      recipientCuit: row.recipientCuit,
      recipientName: row.recipientName,
      recipientIva: row.recipientIva,
      invoiceDate: row.invoiceDate,
      subtotalArs: row.subtotalArs.toString(),
      ivaBreakdown: row.ivaBreakdown as IvaAliquot[],
      totalIvaArs: row.totalIvaArs.toString(),
      totalArs: row.totalArs.toString(),
      state: row.state as InvoiceProps['state'],
      cae: row.cae ?? undefined,
      caeExpiresAt: row.caeExpiresAt ?? undefined,
      isContingency: row.isContingency,
      caea: row.caea ?? undefined,
      originalInvoiceId: row.originalInvoiceId ?? undefined,
      bullJobId: row.bullJobId ?? undefined,
      arcaAttempts: row.arcaAttempts,
      lastArcaError: row.lastArcaError ?? undefined,
      pdfPath: row.pdfPath ?? undefined,
      version: row.version,
      createdById: row.createdById,
      approvedAt: row.approvedAt ?? undefined,
      failedAt: row.failedAt ?? undefined,
      voidedAt: row.voidedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines,
    });
  }
}

