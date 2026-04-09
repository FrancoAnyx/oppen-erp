import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError, IllegalStateTransitionError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IPurchaseOrderRepository,
  PURCHASE_ORDER_REPOSITORY,
} from '../../domain/repositories/purchases.repositories';

export interface ConfirmPurchaseOrderCommand {
  tenantId: string;
  orderId: string;
  confirmedById: string;
  /** TC USD/ARS al momento de confirmar — snapshot para costeo */
  fxRate?: string;
}

export interface ConfirmPurchaseOrderResult {
  orderId: string;
  orderNumber: number;
  incomingMoveIds: string[];
}

/**
 * ConfirmPurchaseOrderUseCase — transiciona la OC de DRAFT → CONFIRMED.
 *
 * Por cada línea crea un StockMove en estado CONFIRMED con:
 *   source = SUPPLIER (location virtual)
 *   dest   = INTERNAL (depósito principal)
 *   state  = CONFIRMED  ← esto hace que cuente como "Incoming" en el stock
 *
 * El stock Incoming aparece en StockCalculatorService como unidades que
 * van a llegar (en camino). Los vendedores ven este número para saber
 * cuándo pueden prometer entregas.
 *
 * Cuando el proveedor entrega físicamente, ReceivePurchaseOrderUseCase
 * marca esos moves como DONE → pasan a Physical.
 */
@Injectable()
export class ConfirmPurchaseOrderUseCase {
  private readonly logger = new Logger(ConfirmPurchaseOrderUseCase.name);

  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY)
    private readonly poRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: ConfirmPurchaseOrderCommand): Promise<ConfirmPurchaseOrderResult> {
    const po = await this.poRepo.findById(cmd.tenantId, cmd.orderId);
    if (!po) throw new NotFoundError('PurchaseOrder', cmd.orderId);

    // Idempotencia
    if (po.currentState === 'CONFIRMED') {
      const existingMoveIds = po.lines
        .map((l) => l.incomingMoveId)
        .filter((id): id is string => !!id);
      return { orderId: po.id, orderNumber: po.orderNumber, incomingMoveIds: existingMoveIds };
    }

    if (po.currentState !== 'DRAFT') {
      throw new IllegalStateTransitionError('PurchaseOrder', po.currentState, 'confirm');
    }

    // ---- Resolver locations ----
    const [supplierLoc, internalLoc] = await Promise.all([
      this.prisma.location.findFirst({
        where: { tenantId: cmd.tenantId, locationType: 'SUPPLIER', isActive: true },
        select: { id: true },
      }),
      this.prisma.location.findFirst({
        where: { tenantId: cmd.tenantId, locationType: 'INTERNAL', isActive: true },
        select: { id: true },
      }),
    ]);

    if (!supplierLoc) throw new NotFoundError('Location', { locationType: 'SUPPLIER' });
    if (!internalLoc) throw new NotFoundError('Location', { locationType: 'INTERNAL' });

    // ---- Crear stock moves CONFIRMED (Incoming) por cada línea ----
    const lineMovePairs: Array<{ lineId: string; moveId: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const line of po.lines) {
        const move = await tx.stockMove.create({
          data: {
            tenantId: cmd.tenantId,
            productId: line.productId,
            quantity: line.quantity,
            uom: line.uom,
            sourceLocationId: supplierLoc.id,
            destLocationId: internalLoc.id,
            // CONFIRMED = aparece en "Incoming", aún no en Physical
            state: 'CONFIRMED',
            originDocType: 'PO',
            originDocId: po.id,
            originLineId: line.id,
            unitCost: undefined,     // en ARS — calculado post recepción con TC
            unitCostUsd: line.unitCostUsd,
            fxRate: cmd.fxRate ?? null,
            scheduledDate: po.expectedDate ?? new Date(),
            createdById: cmd.confirmedById,
          },
          select: { id: true },
        });

        lineMovePairs.push({ lineId: line.id, moveId: move.id });
        this.logger.log(
          `Incoming move created: product=${line.productId} qty=${line.quantity} moveId=${move.id}`,
        );
      }
    });

    // ---- Confirmar aggregate ----
    po.confirm(lineMovePairs, cmd.fxRate);
    const saved = await this.poRepo.update(po);

    return {
      orderId: saved.id,
      orderNumber: saved.orderNumber,
      incomingMoveIds: lineMovePairs.map((p) => p.moveId),
    };
  }
}




