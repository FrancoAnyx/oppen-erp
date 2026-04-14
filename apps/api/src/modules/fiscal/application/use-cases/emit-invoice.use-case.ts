// =============================================================================
// apps/api/src/modules/fiscal/application/use-cases/emit-invoice.use-case.ts
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Decimal } from 'decimal.js';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IInvoiceRepository,
  INVOICE_REPOSITORY,
} from '../../domain/repositories/fiscal.repositories';
import { Invoice } from '../../domain/entities/invoice';

// ---- Queue name (compartido con el worker) ----------------------------------
export const INVOICE_QUEUE = 'fiscal:invoices';
export const INVOICE_JOB_NAME = 'emit-invoice';

export interface InvoiceJobPayload {
  tenantId: string;
  invoiceId: string;
  attempt: number;
}

// ---- Command / Result -------------------------------------------------------

export interface EmitInvoiceCommand {
  tenantId: string;
  salesOrderId: string;
  posNumberId: string;
  createdById: string;
  /** Fecha del comprobante (default: hoy) */
  invoiceDate?: Date;
  /**
   * Si true, fuerza tipo Factura C (emisor Monotributo).
   * Normalmente se determina automáticamente por ivaCondition.
   */
  forceDocType?: number;
}

export interface EmitInvoiceResult {
  invoiceId: string;
  docTypeCode: number;
  docTypeDesc: string;
  totalArs: string;
  state: string;
  jobId: string;
}

// ---- Use case ---------------------------------------------------------------

/**
 * EmitInvoiceUseCase
 *
 * RESPONSABILIDADES:
 *   1. Validar que la OV esté en DELIVERED
 *   2. Validar que no exista una factura APPROVED ya emitida para esa OV
 *   3. Determinar el tipo de comprobante (A/B/C) por condición IVA
 *   4. Construir las líneas de la factura desde las líneas de la OV
 *   5. Persistir la Invoice en PENDING
 *   6. Encolar el job en BullMQ → retorna inmediatamente
 *
 * El worker (ProcessInvoiceJobProcessor) toma el job y llama a ARCA de
 * forma asíncrona. El cliente consulta el estado vía GET /invoices/:id.
 *
 * CONCURRENCIA:
 *   Dos requests simultáneos para la misma OV pueden crear dos facturas.
 *   Prevenido con constraint UNIQUE en DB:
 *     (tenant_id, sales_order_id, state IN (PENDING,QUEUED,PROCESSING,APPROVED))
 *   Si Prisma lanza P2002 en ese unique, retornamos la existente.
 */
@Injectable()
export class EmitInvoiceUseCase {
  private readonly logger = new Logger(EmitInvoiceUseCase.name);

  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    @InjectQueue(INVOICE_QUEUE)
    private readonly invoiceQueue: Queue<InvoiceJobPayload>,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: EmitInvoiceCommand): Promise<EmitInvoiceResult> {
    // ---- 1. Cargar OV con líneas y datos del cliente ----
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: cmd.salesOrderId, tenantId: cmd.tenantId },
      include: {
        lines: true,
        customer: {
          select: {
            taxId: true,
            legalName: true,
            ivaCondition: true,
          },
        },
      },
    });

    if (!so) throw new NotFoundError('SalesOrder', cmd.salesOrderId);

    // ---- 2. Estado de la OV ----
    if (so.state !== 'DELIVERED') {
      throw new BusinessRuleError(
        'INV_SO_NOT_DELIVERED',
        `Cannot invoice a sales order in state "${so.state}". Must be DELIVERED first.`,
        { salesOrderId: cmd.salesOrderId, state: so.state },
      );
    }

    // ---- 3. Idempotencia — verificar si ya hay factura activa ----
    const existing = await this.invoiceRepo.findBySalesOrder(
      cmd.tenantId,
      cmd.salesOrderId,
    );
    const active = existing.find((inv) =>
      ['PENDING', 'QUEUED', 'PROCESSING', 'APPROVED'].includes(inv.currentState),
    );
    if (active) {
      this.logger.warn(
        `Invoice already exists for SO ${cmd.salesOrderId} [inv=${active.id} state=${active.currentState}]`,
      );
      return {
        invoiceId: active.id,
        docTypeCode: active.docTypeCode,
        docTypeDesc: active.toProps().docTypeDesc,
        totalArs: active.totalArs,
        state: active.currentState,
        jobId: active.bullJobId ?? '',
      };
    }

    // ---- 4. Validar POS ----
    const posRef = await this.prisma.posNumber.findFirst({
      where: { id: cmd.posNumberId, tenantId: cmd.tenantId, isActive: true },
      select: { id: true, number: true },
    });
    if (!posRef) throw new NotFoundError('PosNumber', cmd.posNumberId);

    // ---- 5. Datos del tenant (emisor) ----
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: cmd.tenantId },
      select: { cuit: true, legalName: true, ivaCondition: true },
    });
    if (!tenant) throw new NotFoundError('Tenant', cmd.tenantId);

    // ---- 6. Determinar tipo de comprobante ----
    const { code: docTypeCode, desc: docTypeDesc } = cmd.forceDocType
      ? { code: cmd.forceDocType, desc: Invoice['DOC_TYPE_LABELS']?.[cmd.forceDocType] ?? '' }
      : Invoice.resolveDocType(
          tenant.ivaCondition,
          so.customer.ivaCondition,
        );

    // ---- 7. Construir líneas de la factura desde la OV ----
    const invoiceLines = so.lines.map((l) => ({
      description: l.description ?? `Producto ${l.productId}`,
      quantity: l.quantity.toString(),
      uom: l.uom,
      unitPriceArs: l.unitPriceArs.toString(),
      discountPct: l.discountPct.toString(),
      ivaRate: l.ivaRate.toString(),
      salesOrderLineId: l.id,
    }));

    // ---- 8. Crear el aggregate ----
    const invoice = Invoice.create({
      tenantId: cmd.tenantId,
      salesOrderId: cmd.salesOrderId,
      posNumberId: posRef.id,
      posNumber: posRef.number,
      docTypeCode,
      recipientCuit: so.customer.taxId,
      recipientName: so.customer.legalName,
      recipientIva: so.customer.ivaCondition,
      invoiceDate: cmd.invoiceDate ?? new Date(),
      createdById: cmd.createdById,
      lines: invoiceLines,
    });

    // ---- 9. Persistir en PENDING ----
    const saved = await this.invoiceRepo.create(invoice);

    // ---- 10. Encolar en BullMQ ----
    const job = await this.invoiceQueue.add(
      INVOICE_JOB_NAME,
      {
        tenantId: cmd.tenantId,
        invoiceId: saved.id,
        attempt: 1,
      },
      {
        jobId: `invoice-${saved.id}`,  // idempotencia en la queue
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 3000,  // 3s, 6s, 12s, 24s, 48s
        },
        removeOnComplete: false,  // mantener para auditoría
        removeOnFail: false,
      },
    );

    // ---- 11. Registrar jobId en la Invoice ----
    saved.markQueued(job.id ?? `invoice-${saved.id}`);
    await this.invoiceRepo.update(saved);

    this.logger.log(
      `Invoice ${saved.id} (${docTypeDesc}) encolada — ` +
      `SO=${cmd.salesOrderId} Total=ARS ${saved.totalArs} job=${job.id}`,
    );

    return {
      invoiceId: saved.id,
      docTypeCode,
      docTypeDesc,
      totalArs: saved.totalArs,
      state: 'QUEUED',
      jobId: job.id ?? '',
    };
  }
}
