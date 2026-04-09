import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IPurchaseOrderRepository,
  PURCHASE_ORDER_REPOSITORY,
} from '../../domain/repositories/purchases.repositories';
import { PurchaseOrder } from '../../domain/entities/purchase-order';

export interface CreatePOFromBackordersCommand {
  tenantId: string;
  /** ID de la OV que tiene líneas en backorder */
  salesOrderId: string;
  /** Proveedor al que se le va a comprar (el usuario lo elige) */
  supplierId: string;
  createdById: string;
  /** TC USD/ARS sugerido para calcular precios de referencia */
  fxRateSuggested?: string;
  /** Fecha de entrega esperada del proveedor */
  expectedDate?: Date;
  /** Override de costo por producto (si no viene, deja unitCostUsd = 0 para que el usuario lo complete) */
  costOverrides?: Array<{ productId: string; unitCostUsd: string }>;
}

export interface CreatePOFromBackordersResult {
  orderId: string;
  orderNumber: number;
  linesCreated: number;
  /** Líneas que no pudieron incluirse (producto inactivo, etc.) */
  skippedLines: Array<{ soLineId: string; reason: string }>;
}

/**
 * CreatePOFromBackordersUseCase — genera una OC sugerida desde los backorders de una OV.
 *
 * Este es el punto de integración BACK-TO-BACK entre Sales y Purchases:
 *
 *   OV confirmada con backorder
 *       │
 *       └─> CreatePOFromBackorders
 *               │
 *               └─> PO en DRAFT (el usuario revisa costos y confirma)
 *                       │
 *                       └─> ConfirmPO → StockMoves CONFIRMED (Incoming)
 *                               │
 *                               └─> ReceivePO → StockMoves DONE (Physical)
 *                                       │
 *                                       └─> Stock disponible para entregar la OV
 *
 * DISEÑO:
 *   - La OC se crea en DRAFT para que el usuario revise costos antes de confirmar.
 *   - soOriginId en la OC apunta a la OV origen (trazabilidad).
 *   - soLineOriginId en cada línea de OC apunta a la línea de OV correspondiente.
 *   - Si el usuario no provee costOverrides, unitCostUsd queda en 0 — la OC es
 *     una "solicitud de compra" que el comprador completa.
 *   - Solo se incluyen las líneas de OV que tienen requiresBackorder=true.
 */
@Injectable()
export class CreatePOFromBackordersUseCase {
  private readonly logger = new Logger(CreatePOFromBackordersUseCase.name);

  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY)
    private readonly poRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreatePOFromBackordersCommand): Promise<CreatePOFromBackordersResult> {
    // ---- 1. Cargar OV y sus líneas en backorder ----
    const so = await this.prisma.salesOrder.findFirst({
      where: { id: cmd.salesOrderId, tenantId: cmd.tenantId },
      select: { id: true, state: true, orderNumber: true },
    });
    if (!so) throw new NotFoundError('SalesOrder', cmd.salesOrderId);

    if (so.state !== 'CONFIRMED' && so.state !== 'PARTIAL') {
      throw new BusinessRuleError(
        'SO_NOT_CONFIRMED',
        `SalesOrder must be in CONFIRMED or PARTIAL state to generate backorder PO, got: ${so.state}`,
        { salesOrderId: cmd.salesOrderId, state: so.state },
      );
    }

    const backorderLines = await this.prisma.salesOrderLine.findMany({
      where: {
        orderId: cmd.salesOrderId,
        tenantId: cmd.tenantId,
        requiresBackorder: true,
      },
      include: {
        product: { select: { id: true, sku: true, name: true, isActive: true } },
      },
      orderBy: { lineNumber: 'asc' },
    });

    if (backorderLines.length === 0) {
      throw new BusinessRuleError(
        'SO_NO_BACKORDER_LINES',
        'Sales order has no backorder lines',
        { salesOrderId: cmd.salesOrderId },
      );
    }

    // ---- 2. Validar proveedor ----
    const supplier = await this.prisma.entity.findFirst({
      where: { id: cmd.supplierId, tenantId: cmd.tenantId, isActive: true },
      select: { id: true, entityType: true, legalName: true },
    });
    if (!supplier) throw new NotFoundError('Supplier', cmd.supplierId);
    if (!supplier.entityType.includes('SUPPLIER')) {
      throw new BusinessRuleError(
        'ENTITY_NOT_A_SUPPLIER',
        `Entity does not have SUPPLIER role`,
        { entityId: cmd.supplierId },
      );
    }

    // ---- 3. Construir líneas de la OC ----
    const costMap = new Map(
      (cmd.costOverrides ?? []).map((c) => [c.productId, c.unitCostUsd]),
    );

    const skippedLines: CreatePOFromBackordersResult['skippedLines'] = [];
    const poLines: Parameters<typeof PurchaseOrder.create>[0]['lines'] = [];

    for (const soLine of backorderLines) {
      if (!soLine.product.isActive) {
        skippedLines.push({
          soLineId: soLine.id,
          reason: `Product ${soLine.product.sku} is inactive`,
        });
        continue;
      }

      // Cantidad pendiente de entrega (la OV puede tener entrega parcial)
      const qtyToOrder = soLine.quantity.toString();

      poLines.push({
        productId: soLine.productId,
        quantity: qtyToOrder,
        unitCostUsd: costMap.get(soLine.productId) ?? '0',
        ivaRate: '0',   // IVA de importación a definir por el comprador
        description: soLine.product.name,
        uom: soLine.uom,
        soLineOriginId: soLine.id,
        lineNumber: poLines.length + 1,
      });
    }

    if (poLines.length === 0) {
      throw new BusinessRuleError(
        'PO_NO_VALID_LINES',
        'No valid lines to include in the purchase order',
        { skippedLines },
      );
    }

    // ---- 4. Número de secuencia ----
    const orderNumber = await this.poRepo.nextOrderNumber(cmd.tenantId);

    // ---- 5. Construir y persistir OC ----
    const po = PurchaseOrder.create({
      tenantId: cmd.tenantId,
      supplierId: cmd.supplierId,
      orderNumber,
      currency: 'USD',
      expectedDate: cmd.expectedDate,
      soOriginId: cmd.salesOrderId,
      notes: `Back-to-back desde OV #${so.orderNumber}`,
      createdById: cmd.createdById,
      lines: poLines,
    });

    const saved = await this.poRepo.create(po);

    this.logger.log(
      `Back-to-back PO #${saved.orderNumber} created from SO #${so.orderNumber} ` +
        `— ${poLines.length} lines, ${skippedLines.length} skipped`,
    );

    return {
      orderId: saved.id,
      orderNumber: saved.orderNumber,
      linesCreated: poLines.length,
      skippedLines,
    };
  }
}








