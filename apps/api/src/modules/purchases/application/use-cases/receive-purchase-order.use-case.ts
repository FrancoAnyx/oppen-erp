import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { NotFoundError, BusinessRuleError, IllegalStateTransitionError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IPurchaseOrderRepository,
  PURCHASE_ORDER_REPOSITORY,
} from '../../domain/repositories/purchases.repositories';

export interface ReceiveLineInput {
  lineId: string;
  /** Cantidad recibida en esta entrega (puede ser parcial) */
  quantityReceived: string | number;
  /** Costo unitario real en ARS al momento de recibir (para costeo FIFO) */
  unitCostArs?: string;
}

export interface ReceivePurchaseOrderCommand {
  tenantId: string;
  orderId: string;
  receivedById: string;
  lines: ReceiveLineInput[];
  /** TC real al recibir (puede diferir del TC al confirmar) */
  fxRateAtReceipt?: string;
}

export interface ReceivePurchaseOrderResult {
  orderId: string;
  orderNumber: number;
  newState: string;
  /** Moves marcados DONE en esta recepción */
  doneMoveIds: string[];
}

/**
 * ReceivePurchaseOrderUseCase — recepción física de mercadería.
 *
 * FLUJO:
 *   1. Cargar la OC (debe estar CONFIRMED o PARTIAL)
 *   2. Para cada línea recibida:
 *      a. Validar que no exceda quantity_pending
 *      b. Marcar el stock move asociado (incomingMoveId) como DONE
 *         → la mercadería pasa de Incoming a Physical
 *      c. Si la línea fue recibida parcialmente, crear un nuevo move CONFIRMED
 *         por la cantidad restante (reemplaza el move original)
 *   3. Aplicar recepción al aggregate (actualiza quantityReceived por línea)
 *   4. Persistir con optimistic locking
 *
 * COSTEO:
 *   Al marcar el move como DONE, actualizamos el unitCost en ARS.
 *   Esto alimenta al motor FIFO/AVG cuando lo implementemos en Fase 2.
 *
 * RECEPCIÓN PARCIAL:
 *   Si solo se recibe parte de una línea, el move original se DONE por
 *   la cantidad recibida y se crea un nuevo move CONFIRMED por el resto.
 *   Esto preserva el double-entry: Incoming siempre balanceable.
 */
@Injectable()
export class ReceivePurchaseOrderUseCase {
  private readonly logger = new Logger(ReceivePurchaseOrderUseCase.name);

  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY)
    private readonly poRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: ReceivePurchaseOrderCommand): Promise<ReceivePurchaseOrderResult> {
    const po = await this.poRepo.findById(cmd.tenantId, cmd.orderId);
    if (!po) throw new NotFoundError('PurchaseOrder', cmd.orderId);

    if (po.currentState !== 'CONFIRMED' && po.currentState !== 'PARTIAL') {
      throw new IllegalStateTransitionError('PurchaseOrder', po.currentState, 'receive');
    }

    // ---- Resolver la location INTERNAL destino ----
    const internalLoc = await this.prisma.location.findFirst({
      where: { tenantId: cmd.tenantId, locationType: 'INTERNAL', isActive: true },
      select: { id: true },
    });
    if (!internalLoc) throw new NotFoundError('Location', { locationType: 'INTERNAL' });

    const supplierLoc = await this.prisma.location.findFirst({
      where: { tenantId: cmd.tenantId, locationType: 'SUPPLIER', isActive: true },
      select: { id: true },
    });
    if (!supplierLoc) throw new NotFoundError('Location', { locationType: 'SUPPLIER' });

    const doneMoveIds: string[] = [];

    // ---- Procesar cada línea dentro de una transacción ----
    await this.prisma.$transaction(async (tx) => {
      for (const recv of cmd.lines) {
        const line = po.lines.find((l) => l.id === recv.lineId);
        if (!line) {
          throw new NotFoundError('PurchaseOrderLine', recv.lineId);
        }

        const qtyToReceive = new Decimal(String(recv.quantityReceived));
        if (qtyToReceive.lte(0)) {
          throw new BusinessRuleError(
            'PO_RECV_QTY_ZERO',
            'Quantity to receive must be > 0',
            { lineId: recv.lineId },
          );
        }

        if (qtyToReceive.gt(line.quantityPending)) {
          throw new BusinessRuleError(
            'PO_RECV_OVER_QUANTITY',
            `Cannot receive ${qtyToReceive.toFixed(4)} — only ${line.quantityPending.toFixed(4)} pending`,
            { lineId: recv.lineId, pending: line.quantityPending.toFixed(4) },
          );
        }

        const isParcial = qtyToReceive.lt(line.quantityPending);

        if (line.incomingMoveId) {
          if (isParcial) {
            // ---- Recepción parcial: cancelar move original + crear dos nuevos ----
            // 1. Cancelar el move CONFIRMED original
            await tx.stockMove.update({
              where: { id: line.incomingMoveId },
              data: {
                state: 'CANCELLED',
                cancelledAt: new Date(),
                cancelReason: `Partial receipt: ${qtyToReceive.toFixed(4)} of ${line.quantity}`,
              },
            });

            // 2. Crear move DONE por la cantidad recibida → Physical
            const doneMove = await tx.stockMove.create({
              data: {
                tenantId: cmd.tenantId,
                productId: line.productId,
                quantity: qtyToReceive.toFixed(4),
                uom: line.uom,
                sourceLocationId: supplierLoc.id,
                destLocationId: internalLoc.id,
                state: 'DONE',
                originDocType: 'PO',
                originDocId: po.id,
                originLineId: line.id,
                unitCostUsd: line.unitCostUsd,
                unitCost: recv.unitCostArs ?? null,
                fxRate: cmd.fxRateAtReceipt ?? null,
                scheduledDate: new Date(),
                doneDate: new Date(),
                createdById: cmd.receivedById,
              },
              select: { id: true },
            });
            doneMoveIds.push(doneMove.id);

            // 3. Crear nuevo move CONFIRMED por el resto → sigue en Incoming
            const remaining = line.quantityPending.minus(qtyToReceive);
            await tx.stockMove.create({
              data: {
                tenantId: cmd.tenantId,
                productId: line.productId,
                quantity: remaining.toFixed(4),
                uom: line.uom,
                sourceLocationId: supplierLoc.id,
                destLocationId: internalLoc.id,
                state: 'CONFIRMED',
                originDocType: 'PO',
                originDocId: po.id,
                originLineId: line.id,
                unitCostUsd: line.unitCostUsd,
                fxRate: cmd.fxRateAtReceipt ?? null,
                scheduledDate: new Date(),
                createdById: cmd.receivedById,
              },
            });

            this.logger.log(
              `Partial receipt: line=${line.id} received=${qtyToReceive.toFixed(4)} remaining=${remaining.toFixed(4)}`,
            );
          } else {
            // ---- Recepción total: marcar move original como DONE ----
            await tx.stockMove.update({
              where: { id: line.incomingMoveId },
              data: {
                state: 'DONE',
                doneDate: new Date(),
                unitCost: recv.unitCostArs ?? null,
                fxRate: cmd.fxRateAtReceipt ?? null,
              },
            });
            doneMoveIds.push(line.incomingMoveId);
            this.logger.log(`Full receipt: line=${line.id} move=${line.incomingMoveId} DONE`);
          }
        } else {
          // Línea sin incomingMoveId (ej: OC creada sin confirmar primero — edge case)
          // Crear directamente un move DONE
          const move = await tx.stockMove.create({
            data: {
              tenantId: cmd.tenantId,
              productId: line.productId,
              quantity: qtyToReceive.toFixed(4),
              uom: line.uom,
              sourceLocationId: supplierLoc.id,
              destLocationId: internalLoc.id,
              state: 'DONE',
              originDocType: 'PO',
              originDocId: po.id,
              originLineId: line.id,
              unitCostUsd: line.unitCostUsd,
              unitCost: recv.unitCostArs ?? null,
              fxRate: cmd.fxRateAtReceipt ?? null,
              scheduledDate: new Date(),
              doneDate: new Date(),
              createdById: cmd.receivedById,
            },
            select: { id: true },
          });
          doneMoveIds.push(move.id);
        }
      }
    });

    // ---- Aplicar al aggregate ----
    const receipts = cmd.lines.map((r) => ({
      lineId: r.lineId,
      quantity: new Decimal(String(r.quantityReceived)),
    }));
    po.receive(receipts);

    const saved = await this.poRepo.update(po);

    return {
      orderId: saved.id,
      orderNumber: saved.orderNumber,
      newState: saved.currentState,
      doneMoveIds,
    };
  }
}





