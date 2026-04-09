import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { PurchaseOrder } from '../../domain/entities/purchase-order';
import {
  IPurchaseOrderRepository,
  PURCHASE_ORDER_REPOSITORY,
} from '../../domain/repositories/purchases.repositories';

export interface CreatePurchaseOrderCommand {
  tenantId: string;
  supplierId: string;
  createdById: string;
  currency?: string;
  expectedDate?: Date;
  deliveryAddress?: string;
  notes?: string;
  /** FK lógica a la OV que originó esta OC (back-to-back) */
  soOriginId?: string;
  lines: Array<{
    productId: string;
    quantity: string | number;
    unitCostUsd: string | number;
    ivaRate?: string | number;
    description?: string;
    uom?: string;
    soLineOriginId?: string;
  }>;
}

export interface CreatePurchaseOrderResult {
  orderId: string;
  orderNumber: number;
}

@Injectable()
export class CreatePurchaseOrderUseCase {
  constructor(
    @Inject(PURCHASE_ORDER_REPOSITORY)
    private readonly poRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreatePurchaseOrderCommand): Promise<CreatePurchaseOrderResult> {
    // ---- 1. Validar proveedor ----
    const supplier = await this.prisma.entity.findFirst({
      where: { id: cmd.supplierId, tenantId: cmd.tenantId, isActive: true },
      select: { id: true, entityType: true, legalName: true },
    });
    if (!supplier) throw new NotFoundError('Supplier', cmd.supplierId);
    if (!supplier.entityType.includes('SUPPLIER')) {
      throw new BusinessRuleError(
        'ENTITY_NOT_A_SUPPLIER',
        `Entity "${supplier.legalName}" does not have SUPPLIER role`,
        { entityId: cmd.supplierId, roles: supplier.entityType },
      );
    }

    // ---- 2. Validar productos ----
    const productIds = [...new Set(cmd.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: cmd.tenantId, isActive: true },
      select: { id: true, sku: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    for (const line of cmd.lines) {
      if (!productMap.has(line.productId)) {
        throw new NotFoundError('Product', line.productId);
      }
    }

    // ---- 3. Número de secuencia ----
    const orderNumber = await this.poRepo.nextOrderNumber(cmd.tenantId);

    // ---- 4. Construir aggregate ----
    const po = PurchaseOrder.create({
      tenantId: cmd.tenantId,
      supplierId: cmd.supplierId,
      orderNumber,
      currency: cmd.currency,
      expectedDate: cmd.expectedDate,
      deliveryAddress: cmd.deliveryAddress,
      notes: cmd.notes,
      soOriginId: cmd.soOriginId,
      createdById: cmd.createdById,
      lines: cmd.lines.map((l, i) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCostUsd: l.unitCostUsd,
        ivaRate: l.ivaRate,
        description: l.description ?? productMap.get(l.productId)?.name,
        uom: l.uom,
        soLineOriginId: l.soLineOriginId,
        lineNumber: i + 1,
      })),
    });

    // ---- 5. Persistir ----
    const saved = await this.poRepo.create(po);
    return { orderId: saved.id, orderNumber: saved.orderNumber };
  }
}








