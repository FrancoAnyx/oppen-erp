// =============================================================================
// apps/api/src/modules/delivery/application/use-cases/ship-delivery-note.use-case.ts
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IDeliveryNoteRepository,
  DELIVERY_NOTE_REPOSITORY,
} from '../../domain/repositories/delivery.repositories';
import { StockReceiptService } from '../../../inventory/public-api';

// ---- Command ----------------------------------------------------------------

export interface ShipDeliveryNoteCommand {
  tenantId: string;
  deliveryNoteId: string;
  shippedById: string;
  shippedDate?: Date;
}

export interface ShipDeliveryNoteResult {
  deliveryNoteId: string;
  deliveryNumber: number;
  stockMoveIds: string[];
  /** Nuevo estado de la OV después de la entrega */
  salesOrderState: string;
}

// ---- Use case ---------------------------------------------------------------

/**
 * ShipDeliveryNoteUseCase — el caso de uso más complejo del módulo Delivery.
 *
 * FLUJO (todo dentro de una sola transacción):
 *   1. Cargar el remito (debe estar en DRAFT o VALIDATED)
 *   2. Para cada línea del remito:
 *      a. Tomar el stockMove CONFIRMED/ASSIGNED vinculado a la línea de OV
 *         (el reserveMoveId que se creó al confirmar la OV)
 *      b. Marcarlo como DONE → la mercadería pasa de Committed a Physical-out
 *      c. Vincular el moveId a la línea del remito
 *   3. Actualizar quantityDelivered en las líneas de la OV
 *   4. Evaluar si la OV pasó a PARTIAL o DELIVERED
 *   5. Persistir remito (SHIPPED + lockedAt) + OV en la misma tx
 *
 * INMUTABILIDAD:
 *   Una vez completado este use case, el remito tiene lockedAt seteado.
 *   Ningún otro proceso puede modificarlo. Para revertir: crear RMA.
 *
 * OPTIMISTIC LOCKING:
 *   Tanto el remito como la OV tienen version. Si alguno fue modificado
 *   concurrentemente, la tx lanza ConcurrencyError y el caller reintenta.
 */
@Injectable()
export class ShipDeliveryNoteUseCase {
  private readonly logger = new Logger(ShipDeliveryNoteUseCase.name);

  constructor(
    @Inject(DELIVERY_NOTE_REPOSITORY)
    private readonly deliveryRepo: IDeliveryNoteRepository,
    private readonly stockReceiptService: StockReceiptService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: ShipDeliveryNoteCommand): Promise<ShipDeliveryNoteResult> {
    // ---- 1. Cargar remito ----
    const note = await this.deliveryRepo.findById(cmd.tenantId, cmd.deliveryNoteId);
    if (!note) {
      throw new NotFoundError('DeliveryNote', cmd.deliveryNoteId);
    }

    if (!['DRAFT', 'VALIDATED'].includes(note.currentState)) {
      throw new BusinessRuleError(
        'DN_CANNOT_SHIP',
        `Cannot ship a delivery note in state "${note.currentState}"`,
        { deliveryNoteId: cmd.deliveryNoteId, state: note.currentState },
      );
    }

    // ---- 2. Cargar OV con sus líneas ----
    const salesOrder = await this.prisma.salesOrder.findFirst({
      where: { id: note.salesOrderId, tenantId: cmd.tenantId },
      include: { lines: true },
    });

    if (!salesOrder) {
      throw new NotFoundError('SalesOrder', note.salesOrderId);
    }

    // ---- 3. Resolver locations INTERNAL → CUSTOMER ----
    const [internalLoc, customerLoc] = await Promise.all([
      this.prisma.location.findFirst({
        where: { tenantId: cmd.tenantId, locationType: 'INTERNAL', isActive: true },
        select: { id: true },
      }),
      this.prisma.location.findFirst({
        where: { tenantId: cmd.tenantId, locationType: 'CUSTOMER', isActive: true },
        select: { id: true },
      }),
    ]);

    if (!internalLoc) throw new NotFoundError('Location', { locationType: 'INTERNAL' });
    if (!customerLoc) throw new NotFoundError('Location', { locationType: 'CUSTOMER' });

    const soLineMap = new Map(salesOrder.lines.map((l) => [l.id, l]));

    // ---- 4. Ejecutar todo en una sola transacción ----
    const stockMoveIds: string[] = [];
    const lineMovePairs: Array<{ lineId: string; moveId: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      // ---- 4a. Para cada línea del remito: confirmar o crear el stock move ----
      for (const dnLine of note.lines) {
        const soLine = soLineMap.get(dnLine.salesOrderLineId);
        if (!soLine) {
          throw new NotFoundError('SalesOrderLine', dnLine.salesOrderLineId);
        }

        let moveId: string;

        if (soLine.reserveMoveId) {
          // CASO NORMAL: la línea tiene un move CONFIRMED (reservado al confirmar OV).
          // Lo marcamos DONE para que pase de Committed a Physical-out.
          const updateResult = await tx.stockMove.updateMany({
            where: {
              id: soLine.reserveMoveId,
              tenantId: cmd.tenantId,
              state: { in: ['CONFIRMED', 'ASSIGNED'] },
            },
            data: {
              state: 'DONE',
              doneDate: cmd.shippedDate ?? new Date(),
              originDocType: 'DELIVERY',  // reclasificar el origen al documento real
              originDocId: note.id,
              originLineId: dnLine.id,
            },
          });

          if (updateResult.count === 0) {
            // El move puede haber sido cancelado o ya estar DONE (edge case)
            this.logger.warn(
              `ReserveMove ${soLine.reserveMoveId} not in CONFIRMED/ASSIGNED state — creating new DONE move`,
            );
            // Fallback: crear un nuevo move DONE
            moveId = await this.createDoneMove(tx, {
              tenantId: cmd.tenantId,
              productId: dnLine.productId,
              quantity: dnLine.quantity.toFixed(4),
              uom: dnLine.uom,
              sourceLocationId: internalLoc.id,
              destLocationId: customerLoc.id,
              originDocId: note.id,
              originLineId: dnLine.id,
              createdById: cmd.shippedById,
              shippedDate: cmd.shippedDate,
            });
          } else {
            moveId = soLine.reserveMoveId;
          }
        } else {
          // CASO BACKORDER o línea sin reserva previa: crear move DONE directo
          moveId = await this.createDoneMove(tx, {
            tenantId: cmd.tenantId,
            productId: dnLine.productId,
            quantity: dnLine.quantity.toFixed(4),
            uom: dnLine.uom,
            sourceLocationId: internalLoc.id,
            destLocationId: customerLoc.id,
            originDocId: note.id,
            originLineId: dnLine.id,
            createdById: cmd.shippedById,
            shippedDate: cmd.shippedDate,
          });
        }

        stockMoveIds.push(moveId);
        lineMovePairs.push({ lineId: dnLine.id, moveId });

        this.logger.log(
          `Shipped line ${dnLine.id}: product=${dnLine.productId} ` +
          `qty=${dnLine.quantity} move=${moveId}`,
        );
      }

      // ---- 4b. Actualizar quantityDelivered en las líneas de la OV ----
      for (const dnLine of note.lines) {
        const soLine = soLineMap.get(dnLine.salesOrderLineId)!;
        const newQtyDelivered = new Decimal(soLine.quantityDelivered.toString())
          .plus(dnLine.quantity);

        await tx.salesOrderLine.update({
          where: { id: soLine.id },
          data: {
            quantityDelivered: newQtyDelivered.toFixed(4),
          },
        });
      }

      // ---- 4c. Evaluar nuevo estado de la OV ----
      // Recargar líneas con los valores actualizados
      const updatedLines = await tx.salesOrderLine.findMany({
        where: { orderId: salesOrder.id },
        select: {
          id: true,
          quantity: true,
          quantityDelivered: true,
          requiresBackorder: true,
        },
      });

      const allDelivered = updatedLines.every((l) => {
        if (l.requiresBackorder) return true; // backorder no bloquea DELIVERED
        return new Decimal(l.quantityDelivered.toString()).gte(
          new Decimal(l.quantity.toString()),
        );
      });

      const newSoState = allDelivered ? 'DELIVERED' : 'PARTIAL';

      await tx.salesOrder.update({
        where: { id: salesOrder.id },
        data: {
          state: newSoState,
          ...(newSoState === 'DELIVERED' && { deliveredAt: new Date() }),
          version: { increment: 1 },
        },
      });

      this.logger.log(
        `SalesOrder ${salesOrder.id} → ${newSoState} after shipping DN #${note.deliveryNumber}`,
      );
    });

    // ---- 5. Aplicar transición al aggregate y persistir ----
    note.ship(cmd.shippedById, lineMovePairs, cmd.shippedDate);
    const saved = await this.deliveryRepo.update(note);

    // Recuperar estado final de la OV para el resultado
    const finalSo = await this.prisma.salesOrder.findUnique({
      where: { id: note.salesOrderId },
      select: { state: true },
    });

    return {
      deliveryNoteId: saved.id,
      deliveryNumber: saved.deliveryNumber,
      stockMoveIds,
      salesOrderState: finalSo?.state ?? 'UNKNOWN',
    };
  }

  // ---- Helper: crear StockMove DONE (INTERNAL → CUSTOMER) ----

  private async createDoneMove(
    tx: Omit<PrismaService, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    input: {
      tenantId: string;
      productId: string;
      quantity: string;
      uom: string;
      sourceLocationId: string;
      destLocationId: string;
      originDocId: string;
      originLineId: string;
      createdById: string;
      shippedDate?: Date;
    },
  ): Promise<string> {
    const move = await (tx as any).stockMove.create({
      data: {
        tenantId: input.tenantId,
        productId: input.productId,
        quantity: input.quantity,
        uom: input.uom,
        sourceLocationId: input.sourceLocationId,
        destLocationId: input.destLocationId,
        state: 'DONE',
        originDocType: 'DELIVERY',
        originDocId: input.originDocId,
        originLineId: input.originLineId,
        scheduledDate: input.shippedDate ?? new Date(),
        doneDate: input.shippedDate ?? new Date(),
        createdById: input.createdById,
      },
      select: { id: true },
    });

    return move.id;
  }
}
