// =============================================================================
// apps/api/src/modules/fiscal/worker/invoice.processor.ts
// =============================================================================
// BullMQ Processor — toma jobs de 'fiscal:invoices' y llama a ARCA WSFE.
//
// FLUJO:
//   1. Cargar Invoice de DB (debe estar en QUEUED o PROCESSING)
//   2. Marcar PROCESSING (registra intento)
//   3. Obtener último número autorizado para calcular el próximo
//   4. Llamar FECAESolicitar
//   5a. Éxito → marcar APPROVED, actualizar OV a INVOICED, guardar log
//   5b. Fallo → marcar FAILED, guardar log con error
//
// CONTINGENCIA:
//   Si ARCA está caído (timeout / error de conexión), el job falla y BullMQ
//   reintenta con backoff exponencial. Si todos los intentos se agotan y el
//   operador activa FEATURE_ARCA_CONTINGENCY=true, el próximo requeue usa CAEA.
//
// AUDIT:
//   Cada llamada se registra en arca_logs con el XML completo.
//   Esto es OBLIGATORIO para cualquier auditoría fiscal.

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  IInvoiceRepository,
  INVOICE_REPOSITORY,
} from '../domain/repositories/fiscal.repositories';
import {
  IWsfeService,
  WSFE_SERVICE,
  type FECAESolicitarInput,
} from '../infrastructure/arca/wsfe.service';
import {
  INVOICE_QUEUE,
  INVOICE_JOB_NAME,
  type InvoiceJobPayload,
} from '../application/use-cases/emit-invoice.use-case';

@Processor(INVOICE_QUEUE, {
  concurrency: 3,       // máximo 3 facturas procesando simultáneamente
  limiter: {
    max: 10,            // ARCA tiene límite de ~600 req/min; usamos 10/s conservador
    duration: 1000,
  },
})
export class InvoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(InvoiceProcessor.name);

  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
    @Inject(WSFE_SERVICE)
    private readonly wsfe: IWsfeService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<InvoiceJobPayload>): Promise<void> {
    const { tenantId, invoiceId } = job.data;

    this.logger.log(
      `Processing invoice job ${job.id} — invoiceId=${invoiceId} attempt=${job.attemptsMade + 1}`,
    );

    // ---- 1. Cargar Invoice ----
    const invoice = await this.invoiceRepo.findById(tenantId, invoiceId);
    if (!invoice) {
      // No existe — no reintentar
      throw new UnrecoverableError(`Invoice ${invoiceId} not found`);
    }

    if (invoice.currentState === 'APPROVED') {
      this.logger.warn(`Invoice ${invoiceId} already APPROVED — skipping job`);
      return;
    }

    if (invoice.currentState === 'VOIDED') {
      throw new UnrecoverableError(`Invoice ${invoiceId} is VOIDED — cannot process`);
    }

    // ---- 2. Cargar tenant (CUIT del emisor) ----
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { cuit: true },
    });
    if (!tenant) {
      throw new UnrecoverableError(`Tenant ${tenantId} not found`);
    }

    // ---- 3. Marcar PROCESSING ----
    invoice.markProcessing();
    await this.invoiceRepo.update(invoice);

    const t0 = Date.now();
    let requestXml = '';
    let responseXml = '';

    try {
      // ---- 4. Obtener próximo número de comprobante ----
      const ultimoResult = await this.wsfe.ultimoComprobanteAutorizado(
        tenant.cuit,
        invoice.docTypeCode,
        invoice.posNumber,
      );
      const nextDocNumber = ultimoResult.CbteNro + 1;

      // ---- 5. Construir payload FECAESolicitar ----
      const ivaArray = invoice.buildArcaIvaArray();

      // Determinar tipo de documento receptor
      // 80 = CUIT (empresas), 96 = DNI (personas), 99 = Sin identificar (CF)
      const props = invoice.toProps();
      const docTipo = props.recipientIva === 'CF' ? 99 : 80;
      const docNro = props.recipientIva === 'CF' ? '0' : props.recipientCuit;

      // Concepto 1 = Productos (default para reseller tech B2B)
      // Para servicios usar 2, mixto 3
      const concepto: 1 | 2 | 3 = 1;

      const input: FECAESolicitarInput = {
        CbteTipo: invoice.docTypeCode,
        PtoVta: invoice.posNumber,
        Concepto: concepto,
        DocTipo: docTipo,
        DocNro: docNro,
        CbteDesde: nextDocNumber,
        CbteHasta: nextDocNumber,
        CbteFch: this.formatDate(props.invoiceDate),
        ImpNeto: parseFloat(props.subtotalArs),
        ImpTotConc: 0,
        ImpOpEx: 0,
        ImpIVA: parseFloat(props.totalIvaArs),
        ImpTrib: 0,
        ImpTotal: parseFloat(props.totalArs),
        Iva: ivaArray,
        // Para NC/ND: agregar comprobante asociado
        ...(props.originalInvoiceId && await this.buildCbteAsoc(props.originalInvoiceId, tenantId)),
      };

      requestXml = JSON.stringify(input);

      // ---- 6. Llamar ARCA ----
      const result = await this.wsfe.solicitarCAE(tenant.cuit, input);
      responseXml = result.rawResponseXml;
      const durationMs = Date.now() - t0;

      // ---- 7. Evaluar resultado ----
      if (result.Resultado !== 'A') {
        const errMsg = result.Errores
          ?.map((e) => `[${e.Code}] ${e.Msg}`)
          .join('; ') ?? 'Rechazado por ARCA sin detalle';

        // Log del rechazo
        await this.invoiceRepo.appendArcaLog({
          tenantId,
          invoiceId,
          attempt: invoice.arcaAttempts,
          method: 'FECAESolicitar',
          requestXml,
          responseXml,
          resultCode: result.Resultado,
          errorMsg: errMsg,
          durationMs,
        });

        // Rechazos ARCA son errores definitivos (no reintentables con los mismos datos)
        invoice.markFailed(errMsg);
        await this.invoiceRepo.update(invoice);
        throw new UnrecoverableError(`ARCA rechazó el comprobante: ${errMsg}`);
      }

      // ---- 8. Parsear fecha de vencimiento CAE (YYYYMMDD) ----
      const caeVto = this.parseArcaDate(result.CAEFchVto);

      // ---- 9. Marcar APPROVED ----
      invoice.approve({
        cae: result.CAE,
        caeExpiresAt: caeVto,
        docNumber: result.DocNro,
      });

      // ---- 10. Actualizar OV a INVOICED en transacción ----
      await this.prisma.$transaction(async (tx) => {
        // Marcar OV como INVOICED
        await tx.salesOrder.update({
          where: { id: invoice.salesOrderId },
          data: {
            state: 'INVOICED',
            invoicedAt: new Date(),
            version: { increment: 1 },
          },
        });

        // Actualizar quantityInvoiced en las líneas de la OV
        const iProps = invoice.toProps();
        for (const line of iProps.lines) {
          if (line.salesOrderLineId) {
            await tx.salesOrderLine.updateMany({
              where: { id: line.salesOrderLineId, orderId: invoice.salesOrderId },
              data: {
                quantityInvoiced: new Decimal(line.quantity).toFixed(4),
              },
            });
          }
        }
      });

      // ---- 11. Persistir Invoice APPROVED ----
      await this.invoiceRepo.update(invoice);

      // ---- 12. Log de éxito ----
      await this.invoiceRepo.appendArcaLog({
        tenantId,
        invoiceId,
        attempt: invoice.arcaAttempts,
        method: 'FECAESolicitar',
        requestXml,
        responseXml,
        resultCode: 'A',
        durationMs,
      });

      this.logger.log(
        `✅ Invoice ${invoiceId} APPROVED — CAE=${result.CAE} ` +
        `Nro=${result.DocNro} PtoVta=${invoice.posNumber} [${durationMs}ms]`,
      );

    } catch (err: any) {
      const durationMs = Date.now() - t0;

      // Si ya es UnrecoverableError, no registrar como error de conexión
      if (err instanceof UnrecoverableError) throw err;

      // Error de conexión / timeout → BullMQ reintentará con backoff
      const errMsg = err?.message ?? String(err);

      await this.invoiceRepo.appendArcaLog({
        tenantId,
        invoiceId,
        attempt: invoice.arcaAttempts,
        method: 'FECAESolicitar',
        requestXml,
        responseXml: responseXml || '<timeout/>',
        errorMsg: errMsg,
        durationMs,
      });

      this.logger.error(
        `Invoice ${invoiceId} attempt ${job.attemptsMade + 1} failed: ${errMsg}`,
      );

      // Si es el último intento, marcar FAILED definitivo
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 5)) {
        invoice.markFailed(errMsg);
        await this.invoiceRepo.update(invoice);
      } else {
        // Volver a QUEUED para el próximo intento del worker
        invoice.requeue(job.id ?? invoiceId);
        await this.invoiceRepo.update(invoice);
      }

      // Re-lanzar para que BullMQ maneje el backoff
      throw err;
    }
  }

  // ---- Helpers ----

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  private parseArcaDate(yyyymmdd: string): Date {
    const y = parseInt(yyyymmdd.slice(0, 4));
    const m = parseInt(yyyymmdd.slice(4, 6)) - 1;
    const d = parseInt(yyyymmdd.slice(6, 8));
    return new Date(y, m, d);
  }

  private async buildCbteAsoc(
    originalInvoiceId: string,
    tenantId: string,
  ): Promise<{ CbtesAsoc: FECAESolicitarInput['CbtesAsoc'] }> {
    const orig = await this.invoiceRepo.findById(tenantId, originalInvoiceId);
    if (!orig || !orig.docNumber || !orig.cae) {
      return { CbtesAsoc: [] };
    }
    const props = orig.toProps();
    return {
      CbtesAsoc: [{
        Tipo: orig.docTypeCode,
        PtoVta: orig.posNumber,
        Nro: orig.docNumber,
        CbteFch: this.formatDate(props.invoiceDate),
      }],
    };
  }
}
