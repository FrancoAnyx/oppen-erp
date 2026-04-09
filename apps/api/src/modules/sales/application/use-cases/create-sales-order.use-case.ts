import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { SalesOrder } from '../../domain/entities/sales-order';
import {
  ISalesOrderRepository,
  SALES_ORDER_REPOSITORY,
} from '../../domain/repositories/sales.repositories';

export interface CreateSalesOrderCommand {
  tenantId: string;
  customerId: string;
  createdById: string;
  paymentTermDays?: number;
  deliveryAddress?: string;
  notes?: string;
  lines: Array<{
    productId: string;
    quantity: string | number;
    unitPriceArs: string | number;
    discountPct?: string | number;
    ivaRate: string | number;
    description?: string;
    uom?: string;
  }>;
}

export interface CreateSalesOrderResult {
  orderId: string;
  orderNumber: number;
}

/**
 * CreateSalesOrderUseCase — crea una OV en estado DRAFT.
 *
 * Valida:
 *   1. El cliente existe, está activo y tiene rol CUSTOMER
 *   2. Cada producto existe, está activo y pertenece al tenant
 *   3. Precondiciones de líneas (qty > 0, precio >= 0, etc.) — validadas en el aggregate
 *
 * NO reserva stock — eso lo hace ConfirmSalesOrderUseCase.
 * En DRAFT, el usuario puede editar libremente las líneas.
 */
@Injectable()
export class CreateSalesOrderUseCase {
  constructor(
    @Inject(SALES_ORDER_REPOSITORY)
    private readonly salesOrderRepo: any,
    private readonly prisma: PrismaService,
  ) {}

  async execute(cmd: CreateSalesOrderCommand): Promise<CreateSalesOrderResult> {
    // ---- 1. Validar cliente ----
    const customer = await this.prisma.entity.findFirst({
      where: { id: cmd.customerId, tenantId: cmd.tenantId, isActive: true },
      select: { id: true, entityType: true, legalName: true },
    });

    if (!customer) {
      throw new NotFoundError('Customer', cmd.customerId);
    }

    if (!customer.entityType.includes('CUSTOMER')) {
      throw new BusinessRuleError(
        'ENTITY_NOT_A_CUSTOMER',
        `Entity "${customer.legalName}" does not have CUSTOMER role`,
        { entityId: cmd.customerId, roles: customer.entityType },
      );
    }

    // ---- 2. Validar que todos los productos existen y están activos ----
    const productIds = [...new Set(cmd.lines.map((l) => l.productId))];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId: cmd.tenantId,
        isActive: true,
      },
      select: { id: true, sku: true, name: true, listPriceArs: true, ivaRate: true },
    });

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const line of cmd.lines) {
      if (!productMap.has(line.productId)) {
        throw new NotFoundError('Product', line.productId);
      }
    }

    // ---- 3. Obtener número de secuencia ----
    const orderNumber = await this.salesOrderRepo.nextOrderNumber(cmd.tenantId);

    // ---- 4. Construir aggregate (las validaciones de línea se hacen en el VO) ----
    const order = SalesOrder.create({
      tenantId: cmd.tenantId,
      customerId: cmd.customerId,
      orderNumber,
      createdById: cmd.createdById,
      paymentTermDays: cmd.paymentTermDays,
      deliveryAddress: cmd.deliveryAddress,
      notes: cmd.notes,
      lines: cmd.lines.map((l, i) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPriceArs: l.unitPriceArs,
        discountPct: l.discountPct,
        ivaRate: l.ivaRate,
        description: l.description ?? productMap.get(l.productId)?.name,
        uom: l.uom,
        lineNumber: i + 1,
      })),
    });

    // ---- 5. Persistir ----
    const saved = await this.salesOrderRepo.create(order);

    return { orderId: saved.id, orderNumber: saved.orderNumber };
  }
}






