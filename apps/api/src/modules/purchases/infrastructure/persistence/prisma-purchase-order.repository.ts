import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { ConcurrencyError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  PurchaseOrder,
  PurchaseOrderLine,
  type PurchaseOrderProps,
  type PurchaseOrderLineProps,
} from '../../domain/entities/purchase-order';
import { IPurchaseOrderRepository } from '../../domain/repositories/purchases.repositories';

type PrismaPOWithLines = Prisma.PurchaseOrderGetPayload<{
  include: { lines: true };
}>;
type PrismaPOLine = Prisma.PurchaseOrderLineGetPayload<Record<never, never>>;

@Injectable()
export class PrismaPurchaseOrderRepository implements IPurchaseOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Queries ----

  async findById(tenantId: string, id: string): Promise<PurchaseOrder | null> {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByOrderNumber(tenantId: string, orderNumber: number): Promise<PurchaseOrder | null> {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { tenantId, orderNumber },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findMany(params: {
    tenantId: string;
    supplierId?: string;
    state?: string | string[];
    soOriginId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: PurchaseOrder[]; total: number }> {
    const stateFilter = params.state
      ? { in: Array.isArray(params.state) ? params.state : [params.state] }
      : undefined;

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId: params.tenantId,
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      ...(params.soOriginId ? { soOriginId: params.soOriginId } : {}),
      ...(stateFilter
        ? { state: stateFilter as Prisma.EnumPurchaseOrderStateFilter }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 200),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  // ---- Writes ----

  async create(po: PurchaseOrder): Promise<PurchaseOrder> {
    const s = po.toState();

    const created = await this.prisma.purchaseOrder.create({
      data: {
        tenantId: s.tenantId,
        orderNumber: s.orderNumber,
        supplierId: s.supplierId,
        state: s.state as any,
        currency: s.currency,
        fxRateAtConfirm: s.fxRateAtConfirm ? new Prisma.Decimal(s.fxRateAtConfirm) : null,
        expectedDate: s.expectedDate ?? null,
        deliveryAddress: s.deliveryAddress ?? null,
        notes: s.notes ?? null,
        soOriginId: s.soOriginId ?? null,
        subtotalUsd: new Prisma.Decimal(s.subtotalUsd),
        taxAmountUsd: new Prisma.Decimal(s.taxAmountUsd),
        totalUsd: new Prisma.Decimal(s.totalUsd),
        subtotalArs: new Prisma.Decimal(s.subtotalArs),
        totalArs: new Prisma.Decimal(s.totalArs),
        version: 1,
        createdById: s.createdById,
        lines: {
          create: s.lines.map((l) => this.lineToCreateInput(l.toProps())),
        },
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    return this.toDomain(created);
  }

  async update(po: PurchaseOrder): Promise<PurchaseOrder> {
    const s = po.toState();
    const expectedVersion = s.version;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.purchaseOrder.updateMany({
          where: { id: s.id, tenantId: s.tenantId, version: expectedVersion },
          data: {
            state: s.state as any,
            fxRateAtConfirm: s.fxRateAtConfirm ? new Prisma.Decimal(s.fxRateAtConfirm) : null,
            subtotalUsd: new Prisma.Decimal(s.subtotalUsd),
            taxAmountUsd: new Prisma.Decimal(s.taxAmountUsd),
            totalUsd: new Prisma.Decimal(s.totalUsd),
            subtotalArs: new Prisma.Decimal(s.subtotalArs),
            totalArs: new Prisma.Decimal(s.totalArs),
            confirmedAt: s.confirmedAt ?? null,
            receivedAt: s.receivedAt ?? null,
            cancelledAt: s.cancelledAt ?? null,
            cancelReason: s.cancelReason ?? null,
            version: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          const exists = await tx.purchaseOrder.findFirst({
            where: { id: s.id, tenantId: s.tenantId },
            select: { version: true },
          });
          if (!exists) throw new NotFoundError('PurchaseOrder', s.id);
          throw new ConcurrencyError('PurchaseOrder', expectedVersion, exists.version);
        }

        // Upsert líneas: delete + recreate dentro de la misma tx
        await tx.purchaseOrderLine.deleteMany({ where: { orderId: s.id } });
        if (s.lines.length > 0) {
          await tx.purchaseOrderLine.createMany({
            data: s.lines.map((l) => ({
              ...this.lineToCreateInput(l.toProps()),
              orderId: s.id,
            })),
          });
        }

        return tx.purchaseOrder.findFirstOrThrow({
          where: { id: s.id },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
      });

      return this.toDomain(result);
    } catch (err) {
      if (err instanceof ConcurrencyError || err instanceof NotFoundError) throw err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        throw new ConcurrencyError('PurchaseOrder', expectedVersion, -1);
      }
      throw err;
    }
  }

  async nextOrderNumber(_tenantId: string): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('purchases.purchase_order_number_seq')::bigint AS nextval
    `;
    const row = result[0];
    if (!row) throw new Error('Failed to get next purchase order number');
    return Number(row.nextval);
  }

  // ---- Mapping ----

  private toDomain(row: PrismaPOWithLines): PurchaseOrder {
    return PurchaseOrder.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      orderNumber: row.orderNumber,
      supplierId: row.supplierId,
      state: row.state as PurchaseOrder['currentState'],
      currency: row.currency,
      fxRateAtConfirm: row.fxRateAtConfirm?.toString(),
      expectedDate: row.expectedDate ?? undefined,
      deliveryAddress: row.deliveryAddress ?? undefined,
      notes: row.notes ?? undefined,
      soOriginId: row.soOriginId ?? undefined,
      subtotalUsd: row.subtotalUsd.toString(),
      taxAmountUsd: row.taxAmountUsd.toString(),
      totalUsd: row.totalUsd.toString(),
      subtotalArs: row.subtotalArs.toString(),
      totalArs: row.totalArs.toString(),
      version: row.version,
      createdById: row.createdById,
      confirmedAt: row.confirmedAt ?? undefined,
      receivedAt: row.receivedAt ?? undefined,
      cancelledAt: row.cancelledAt ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines: row.lines.map((l) => this.lineToDomain(l)),
    });
  }

  private lineToDomain(row: PrismaPOLine): PurchaseOrderLine {
    return PurchaseOrderLine.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      orderId: row.orderId,
      productId: row.productId,
      lineNumber: row.lineNumber,
      description: row.description ?? undefined,
      quantity: row.quantity.toString(),
      uom: row.uom,
      unitCostUsd: row.unitCostUsd.toString(),
      ivaRate: row.ivaRate.toString(),
      quantityReceived: row.quantityReceived.toString(),
      incomingMoveId: row.incomingMoveId ?? undefined,
      soLineOriginId: row.soLineOriginId ?? undefined,
      subtotalUsd: row.subtotalUsd.toString(),
      taxAmountUsd: row.taxAmountUsd.toString(),
      totalUsd: row.totalUsd.toString(),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private lineToCreateInput(
    l: PurchaseOrderLineProps,
  ): Omit<Prisma.PurchaseOrderLineCreateManyOrderInput, 'orderId'> & {
    tenantId: string;
  } {
    return {
      tenantId: l.tenantId,
      productId: l.productId,
      lineNumber: l.lineNumber,
      description: l.description ?? null,
      quantity: new Prisma.Decimal(l.quantity),
      uom: l.uom,
      unitCostUsd: new Prisma.Decimal(l.unitCostUsd),
      ivaRate: new Prisma.Decimal(l.ivaRate),
      quantityReceived: new Prisma.Decimal(l.quantityReceived),
      incomingMoveId: l.incomingMoveId ?? null,
      soLineOriginId: l.soLineOriginId ?? null,
      subtotalUsd: new Prisma.Decimal(l.subtotalUsd),
      taxAmountUsd: new Prisma.Decimal(l.taxAmountUsd),
      totalUsd: new Prisma.Decimal(l.totalUsd),
    };
  }
}


