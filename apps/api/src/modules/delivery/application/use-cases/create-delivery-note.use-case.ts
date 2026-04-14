// =============================================================================
// apps/api/src/modules/delivery/application/use-cases/create-delivery-note.use-case.ts
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IDeliveryNoteRepository,
  DELIVERY_NOTE_REPOSITORY,
} from '../../domain/repositories/delivery.repositories';
import {
  DeliveryNote,
  type CreateDeliveryNoteLineProps,
} from '../../domain/entities/delivery-note';

// ---- Command ----------------------------------------------------------------

export interface CreateDeliveryLineInput {
  salesOrderLineId: string;
  productId: string;
  quantity: string | number;
  uom?: string;
  description?: string;
  serialNumbers?: string[];
}

export interface CreateDeliveryNoteCommand {
  tenantId: string;
  salesOrderId: string;
  createdById: string;
  lines: CreateDeliveryLineInput[];
  scheduledDate?: Date;
  carrierId?: string;
  notes?: string;
}

export interface CreateDeliveryNoteResult {
  deliveryNoteId: string;
  deliveryNumber: number;
}

// ---- Use case ---------------------------------------------------------------

/**
 * CreateDeliveryNoteUseCase
 *
 * VALIDACIONES:
 *   1. La OV existe y está en CONFIRMED o PARTIAL (única forma de entregar).
 *   2. Cada línea del remito referencia una línea válida de la OV.
 *   3. La cantidad a entregar no supera la cantidad pendiente (qty - entregado).
 *   4. El número de serie (si aplica) no supera la cantidad.
 *
 * SIDE EFFECTS:
 *   - Ninguno en este paso. El remito se crea en DRAFT.
 *   - El stock se mueve DONE solo al hacer SHIPPED (ShipDeliveryNoteUseCase).
 */
@Injectable()
export class CreateDeliveryNoteUseCase {
  private readonly logger = new Logger(CreateDeliveryNoteUseCase.name);

  constructor(
    @Inject(DELIVERY_NOTE_REPOSITORY)
    private readonly deliveryRepo: IDeliveryNoteRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreateDeliveryNoteCommand): Promise<CreateDeliveryNoteResult> {
    // ---- 1. Cargar la OV con sus líneas ----
    const salesOrder = await this.prisma.salesOrder.findFirst({
      where: { id: cmd.salesOrderId, tenantId: cmd.tenantId },
      include: { lines: true },
    });

    if (!salesOrder) {
      throw new NotFoundError('SalesOrder', cmd.salesOrderId);
    }

    // ---- 2. Validar estado de la OV ----
    if (!['CONFIRMED', 'PARTIAL'].includes(salesOrder.state)) {
      throw new BusinessRuleError(
        'DN_INVALID_SO_STATE',
        `Cannot create delivery for a sales order in state "${salesOrder.state}"`,
        { salesOrderId: cmd.salesOrderId, state: salesOrder.state },
      );
    }

    // ---- 3. Calcular qty ya entregada (remitos activos previos) ----
    const previousDeliveries = await this.deliveryRepo.findActiveBySalesOrder(
      cmd.tenantId,
      cmd.salesOrderId,
    );

    // Mapa: salesOrderLineId → total ya despachado (en remitos no cancelados)
    const deliveredByLine = new Map<string, Decimal>();
    for (const dn of previousDeliveries) {
      for (const dnLine of dn.lines) {
        const current = deliveredByLine.get(dnLine.salesOrderLineId) ?? new Decimal(0);
        // Solo contar SHIPPED y DONE (DRAFT/VALIDATED aún no salió)
        const dnState = dn.currentState;
        if (dnState === 'SHIPPED' || dnState === 'DONE') {
          deliveredByLine.set(dnLine.salesOrderLineId, current.plus(dnLine.quantity));
        }
      }
    }

    // ---- 4. Validar cada línea del remito ----
    const soLineMap = new Map(salesOrder.lines.map((l) => [l.id, l]));
    const lineProps: Omit<CreateDeliveryNoteLineProps, 'tenantId'>[] = [];

    for (const inputLine of cmd.lines) {
      const soLine = soLineMap.get(inputLine.salesOrderLineId);

      if (!soLine) {
        throw new NotFoundError('SalesOrderLine', inputLine.salesOrderLineId);
      }

      if (soLine.productId !== inputLine.productId) {
        throw new BusinessRuleError(
          'DN_PRODUCT_MISMATCH',
          'Product in delivery line does not match sales order line',
          {
            salesOrderLineId: inputLine.salesOrderLineId,
            expectedProductId: soLine.productId,
            gotProductId: inputLine.productId,
          },
        );
      }

      const soQty = new Decimal(soLine.quantity.toString());
      const alreadyDelivered = deliveredByLine.get(soLine.id) ?? new Decimal(0);
      // Cantidad que ya estaba en DRAFT/VALIDATED (en tránsito)
      const inTransit = this.calcInTransit(previousDeliveries, soLine.id);
      const pendingQty = soQty.minus(alreadyDelivered).minus(inTransit);

      const requestedQty = new Decimal(String(inputLine.quantity));

      if (requestedQty.lte(0)) {
        throw new BusinessRuleError(
          'DN_QTY_MUST_BE_POSITIVE',
          'Delivery quantity must be greater than zero',
          { salesOrderLineId: soLine.id, quantity: inputLine.quantity },
        );
      }

      if (requestedQty.gt(pendingQty)) {
        throw new BusinessRuleError(
          'DN_QTY_EXCEEDS_PENDING',
          'Delivery quantity exceeds pending quantity for this line',
          {
            salesOrderLineId: soLine.id,
            requested: requestedQty.toFixed(4),
            pending: pendingQty.toFixed(4),
            alreadyDelivered: alreadyDelivered.toFixed(4),
            inTransit: inTransit.toFixed(4),
          },
        );
      }

      lineProps.push({
        salesOrderLineId: soLine.id,
        productId: soLine.productId,
        lineNumber: lineProps.length + 1,
        description: inputLine.description ?? soLine.description ?? undefined,
        quantity: requestedQty.toFixed(4),
        uom: inputLine.uom ?? soLine.uom,
        unitPriceArs: soLine.unitPriceArs.toString(),
        serialNumbers: inputLine.serialNumbers ?? [],
      });
    }

    // ---- 5. Datos del destinatario desde la entidad de la OV ----
    const customer = await this.prisma.entity.findFirst({
      where: { id: salesOrder.customerId, tenantId: cmd.tenantId },
      select: {
        id: true,
        legalName: true,
        taxId: true,
        address: true,
        city: true,
        province: true,
      },
    });

    if (!customer) {
      throw new NotFoundError('Entity', salesOrder.customerId);
    }

    // ---- 6. Obtener número de remito ----
    const deliveryNumber = await this.deliveryRepo.nextDeliveryNumber(cmd.tenantId);

    // ---- 7. Crear el aggregate ----
    const note = DeliveryNote.create({
      tenantId: cmd.tenantId,
      deliveryNumber,
      salesOrderId: cmd.salesOrderId,
      recipientId: customer.id,
      recipientName: customer.legalName,
      recipientCuit: customer.taxId,
      recipientAddress: [customer.address, customer.city, customer.province]
        .filter(Boolean)
        .join(', ') || undefined,
      scheduledDate: cmd.scheduledDate,
      carrierId: cmd.carrierId,
      notes: cmd.notes,
      createdById: cmd.createdById,
      lines: lineProps,
    });

    // ---- 8. Persistir ----
    const saved = await this.deliveryRepo.create(note);

    this.logger.log(
      `DeliveryNote #${saved.deliveryNumber} created for SO ${cmd.salesOrderId} ` +
      `[${saved.lines.length} lines, id=${saved.id}]`,
    );

    return {
      deliveryNoteId: saved.id,
      deliveryNumber: saved.deliveryNumber,
    };
  }

  /**
   * Calcula la cantidad "en tránsito" (remitos en DRAFT o VALIDATED) para
   * una línea de OV. Estos no se cuentan como entregados pero sí bloquean
   * la creación de nuevos remitos para esa cantidad.
   */
  private calcInTransit(
    previousDeliveries: DeliveryNote[],
    salesOrderLineId: string,
  ): Decimal {
    let inTransit = new Decimal(0);
    for (const dn of previousDeliveries) {
      if (dn.currentState !== 'DRAFT' && dn.currentState !== 'VALIDATED') continue;
      for (const dnLine of dn.lines) {
        if (dnLine.salesOrderLineId === salesOrderLineId) {
          inTransit = inTransit.plus(dnLine.quantity);
        }
      }
    }
    return inTransit;
  }
}
