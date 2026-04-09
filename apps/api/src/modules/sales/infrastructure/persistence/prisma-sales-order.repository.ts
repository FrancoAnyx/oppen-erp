import { Injectable } from '@nestjs/common';
import { Prisma } from '@erp/database';
import { ConcurrencyError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { SalesOrder, type SalesOrderProps } from '../../domain/entities/sales-order';
import {
  SalesOrderLine,
  type SalesOrderLineProps,
} from '../../domain/entities/sales-order-line';
import { ISalesOrderRepository } from '../../domain/repositories/sales.repositories';

// Tipo que Prisma devuelve con include lines
type PrismaSalesOrderWithLines = Prisma.SalesOrderGetPayload<{
  include: { lines: true };
}>;

type PrismaSalesOrderLine = Prisma.SalesOrderLineGetPayload<Record<never, never>>;

@Injectable()
export class PrismaSalesOrderRepository implements ISalesOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Queries ----

  async findById(tenantId: string, id: string): Promise<SalesOrder | null> {
    const row = await this.prisma.salesOrder.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByOrderNumber(
    tenantId: string,
    orderNumber: number,
  ): Promise<SalesOrder | null> {
    const row = await this.prisma.salesOrder.findFirst({
      where: { tenantId, orderNumber },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findMany(params: {
    tenantId: string;
    customerId?: string;
    state?: string | string[];
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: SalesOrder[]; total: number }> {
    const stateFilter = params.state
      ? { in: Array.isArray(params.state) ? params.state : [params.state] }
      : undefined;

    const where: Prisma.SalesOrderWhereInput = {
      tenantId: params.tenantId,
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(stateFilter ? { state: stateFilter as Prisma.EnumSalesOrderStateFilter } : {}),
      ...(params.search
        ? {
            OR: [
              {
                customer: {
                  legalName: { contains: params.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 200),
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  // ---- Writes ----

  async create(order: SalesOrder): Promise<SalesOrder> {
    const s = order.toState();

    const created = await this.prisma.salesOrder.create({
      data: {
        tenantId: s.tenantId,
        orderNumber: s.orderNumber,
        customerId: s.customerId,
        state: s.state as any,
        currency: s.currency,
        fxRateAtConfirm: s.fxRateAtConfirm ? new Prisma.Decimal(s.fxRateAtConfirm) : null,
        paymentTermDays: s.paymentTermDays,
        deliveryAddress: s.deliveryAddress ?? null,
        notes: s.notes ?? null,
        requiresBackorder: s.requiresBackorder,
        subtotalArs: new Prisma.Decimal(s.subtotalArs),
        taxAmountArs: new Prisma.Decimal(s.taxAmountArs),
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

  async update(order: SalesOrder): Promise<SalesOrder> {
    const s = order.toState();
    const expectedVersion = s.version;

    try {
      // Optimistic locking: WHERE id = $id AND version = $expectedVersion
      // Si otro proceso modificó la OV, el count será 0 → ConcurrencyError
      const result = await this.prisma.$transaction(async (tx) => {
        const updateCount = await tx.salesOrder.updateMany({
          where: {
            id: s.id,
            tenantId: s.tenantId,
            version: expectedVersion,
          },
          data: {
            state: s.state as any,
            fxRateAtConfirm: s.fxRateAtConfirm
              ? new Prisma.Decimal(s.fxRateAtConfirm)
              : null,
            requiresBackorder: s.requiresBackorder,
            subtotalArs: new Prisma.Decimal(s.subtotalArs),
            taxAmountArs: new Prisma.Decimal(s.taxAmountArs),
            totalArs: new Prisma.Decimal(s.totalArs),
            paymentTermDays: s.paymentTermDays,
            deliveryAddress: s.deliveryAddress ?? null,
            notes: s.notes ?? null,
            confirmedAt: s.confirmedAt ?? null,
            deliveredAt: s.deliveredAt ?? null,
            invoicedAt: s.invoicedAt ?? null,
            cancelledAt: s.cancelledAt ?? null,
            cancelReason: s.cancelReason ?? null,
            version: { increment: 1 },
          },
        });

        if (updateCount.count === 0) {
          // Distinguimos entre "no existe" y "version mismatch"
          const exists = await tx.salesOrder.findFirst({
            where: { id: s.id, tenantId: s.tenantId },
            select: { version: true },
          });

          if (!exists) {
            throw new NotFoundError('SalesOrder', s.id);
          }
          throw new ConcurrencyError('SalesOrder', expectedVersion, exists.version);
        }

        // Upsert de líneas: delete old + create new dentro de la misma tx
        // Esto es seguro porque las líneas no tienen FK externas (los moves
        // referencian por originLineId que es el id de línea, pero esa FK
        // es lógica, no a nivel DB).
        await tx.salesOrderLine.deleteMany({ where: { orderId: s.id } });

        if (s.lines.length > 0) {
          await tx.salesOrderLine.createMany({
            data: s.lines.map((l) => ({
              ...this.lineToCreateInput(l.toProps()),
              orderId: s.id,
            })),
          });
        }

        return tx.salesOrder.findFirstOrThrow({
          where: { id: s.id },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
      });

      return this.toDomain(result);
    } catch (err) {
      // Re-throw domain errors sin envolver
      if (err instanceof ConcurrencyError || err instanceof NotFoundError) {
        throw err;
      }
      // Prisma P2034 = serialization failure (concurrencia)
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034'
      ) {
        throw new ConcurrencyError('SalesOrder', expectedVersion, -1);
      }
      throw err;
    }
  }

  async nextOrderNumber(_tenantId: string): Promise<number> {
    // Usa la secuencia de Postgres — race-condition-safe por diseño.
    // Nota: la secuencia es global (no por tenant) en single-tenant.
    // En multi-tenant, se necesita una secuencia por tenant.
    const result = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('sales.sales_order_number_seq')::bigint AS nextval
    `;
    const row = result[0];
    if (!row) throw new Error('Failed to get next order number from sequence');
    return Number(row.nextval);
  }

  // ---- Mapping PrismaModel ↔ DomainEntity ----

  private toDomain(row: PrismaSalesOrderWithLines): SalesOrder {
    const lines = row.lines.map((l) => this.lineToDomain(l));

    return SalesOrder.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      orderNumber: row.orderNumber,
      customerId: row.customerId,
      state: row.state as SalesOrder['currentState'],
      currency: row.currency,
      fxRateAtConfirm: row.fxRateAtConfirm?.toString(),
      paymentTermDays: row.paymentTermDays,
      deliveryAddress: row.deliveryAddress ?? undefined,
      notes: row.notes ?? undefined,
      requiresBackorder: row.requiresBackorder,
      subtotalArs: row.subtotalArs.toString(),
      taxAmountArs: row.taxAmountArs.toString(),
      totalArs: row.totalArs.toString(),
      version: row.version,
      createdById: row.createdById,
      confirmedAt: row.confirmedAt ?? undefined,
      deliveredAt: row.deliveredAt ?? undefined,
      invoicedAt: row.invoicedAt ?? undefined,
      cancelledAt: row.cancelledAt ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines,
    });
  }

  private lineToDomain(row: PrismaSalesOrderLine): SalesOrderLine {
    return SalesOrderLine.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      orderId: row.orderId,
      productId: row.productId,
      lineNumber: row.lineNumber,
      description: row.description ?? undefined,
      quantity: row.quantity.toString(),
      uom: row.uom,
      unitPriceArs: row.unitPriceArs.toString(),
      discountPct: row.discountPct.toString(),
      ivaRate: row.ivaRate.toString(),
      quantityDelivered: row.quantityDelivered.toString(),
      quantityInvoiced: row.quantityInvoiced.toString(),
      requiresBackorder: row.requiresBackorder,
      reserveMoveId: row.reserveMoveId ?? undefined,
      subtotalArs: row.subtotalArs.toString(),
      taxAmountArs: row.taxAmountArs.toString(),
      totalArs: row.totalArs.toString(),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  private lineToCreateInput(
    l: ReturnType<SalesOrderLine['toProps']>,
  ): Omit<Prisma.SalesOrderLineCreateManyOrderInput, 'orderId'> & {
    tenantId: string;
  } {
    return {
      tenantId: l.tenantId,
      productId: l.productId,
      lineNumber: l.lineNumber,
      description: l.description ?? null,
      quantity: new Prisma.Decimal(l.quantity),
      uom: l.uom,
      unitPriceArs: new Prisma.Decimal(l.unitPriceArs),
      discountPct: new Prisma.Decimal(l.discountPct),
      ivaRate: new Prisma.Decimal(l.ivaRate),
      quantityDelivered: new Prisma.Decimal(l.quantityDelivered),
      quantityInvoiced: new Prisma.Decimal(l.quantityInvoiced),
      requiresBackorder: l.requiresBackorder,
      reserveMoveId: l.reserveMoveId ?? null,
      subtotalArs: new Prisma.Decimal(l.subtotalArs),
      taxAmountArs: new Prisma.Decimal(l.taxAmountArs),
      totalArs: new Prisma.Decimal(l.totalArs),
    };
  }
}


