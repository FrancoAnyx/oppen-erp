// =============================================================================
// apps/api/src/modules/delivery/infrastructure/persistence/prisma-delivery.repository.ts
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConcurrencyError, NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  IDeliveryNoteRepository,
  FindManyDeliveryNotesFilter,
} from '../../domain/repositories/delivery.repositories';
import {
  DeliveryNote,
  DeliveryNoteLine,
  type DeliveryNoteProps,
  type DeliveryNoteLineProps,
} from '../../domain/entities/delivery-note';

// Tipos de Prisma inferidos para el include completo
type PrismaDeliveryNoteWithLines = Prisma.DeliveryNoteGetPayload<{
  include: { lines: true };
}>;
type PrismaDeliveryNoteLine = Prisma.DeliveryNoteLineGetPayload<Record<never, never>>;

@Injectable()
export class PrismaDeliveryNoteRepository implements IDeliveryNoteRepository {
  private readonly logger = new Logger(PrismaDeliveryNoteRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- create ----

  async create(note: DeliveryNote): Promise<DeliveryNote> {
    const props = note.toProps();

    const created = await this.prisma.deliveryNote.create({
      data: {
        tenantId: props.tenantId,
        deliveryNumber: props.deliveryNumber,
        salesOrderId: props.salesOrderId,
        recipientId: props.recipientId,
        recipientName: props.recipientName,
        recipientCuit: props.recipientCuit,
        recipientAddress: props.recipientAddress ?? null,
        state: props.state as any,
        scheduledDate: props.scheduledDate ?? null,
        carrierId: props.carrierId ?? null,
        notes: props.notes ?? null,
        internalNotes: props.internalNotes ?? null,
        version: 1,
        createdById: props.createdById,
        lines: {
          create: props.lines.map((l) => ({
            tenantId: l.tenantId,
            salesOrderLineId: l.salesOrderLineId,
            productId: l.productId,
            lineNumber: l.lineNumber,
            description: l.description ?? null,
            quantity: l.quantity,
            uom: l.uom,
            unitPriceArs: l.unitPriceArs,
            serialNumbers: l.serialNumbers,
          })),
        },
      },
      include: { lines: true },
    });

    return this.toDomain(created);
  }

  // ---- update (optimistic locking) ----

  async update(note: DeliveryNote): Promise<DeliveryNote> {
    const props = note.toProps();
    const expectedVersion = props.version;

    try {
      // Actualizar el header con version check
      const result = await this.prisma.deliveryNote.updateMany({
        where: {
          id: props.id,
          tenantId: props.tenantId,
          version: expectedVersion,
        },
        data: {
          state: props.state as any,
          scheduledDate: props.scheduledDate ?? null,
          shippedDate: props.shippedDate ?? null,
          doneDate: props.doneDate ?? null,
          carrierId: props.carrierId ?? null,
          trackingCode: props.trackingCode ?? null,
          notes: props.notes ?? null,
          internalNotes: props.internalNotes ?? null,
          lockedAt: props.lockedAt ?? null,
          pdfPath: props.pdfPath ?? null,
          validatedById: props.validatedById ?? null,
          shippedById: props.shippedById ?? null,
          cancelledAt: props.cancelledAt ?? null,
          cancelReason: props.cancelReason ?? null,
          version: { increment: 1 },
        },
      });

      if (result.count === 0) {
        // Distinguir entre "no existe" y "conflicto de versión"
        const exists = await this.prisma.deliveryNote.findUnique({
          where: { id: props.id },
          select: { version: true },
        });

        if (!exists) {
          throw new NotFoundError('DeliveryNote', props.id);
        }

        throw new ConcurrencyError(
          'DeliveryNote',
          expectedVersion,
          exists.version,
        );
      }

      // Actualizar líneas (stockMoveId y serialNumbers pueden cambiar)
      for (const line of props.lines) {
        if (line.id) {
          await this.prisma.deliveryNoteLine.update({
            where: { id: line.id },
            data: {
              stockMoveId: line.stockMoveId ?? null,
              serialNumbers: line.serialNumbers,
            },
          });
        }
      }

      // Recargar el registro actualizado
      const updated = await this.prisma.deliveryNote.findUniqueOrThrow({
        where: { id: props.id },
        include: { lines: true },
      });

      return this.toDomain(updated);
    } catch (err) {
      if (
        err instanceof ConcurrencyError ||
        err instanceof NotFoundError
      ) {
        throw err;
      }
      this.logger.error(`Update DeliveryNote ${props.id} failed`, err);
      throw err;
    }
  }

  // ---- findById ----

  async findById(tenantId: string, id: string): Promise<DeliveryNote | null> {
    const row = await this.prisma.deliveryNote.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });

    return row ? this.toDomain(row) : null;
  }

  // ---- findMany ----

  async findMany(
    filter: FindManyDeliveryNotesFilter,
  ): Promise<{ items: DeliveryNote[]; total: number }> {
    const where: Prisma.DeliveryNoteWhereInput = {
      tenantId: filter.tenantId,
      ...(filter.salesOrderId && { salesOrderId: filter.salesOrderId }),
      ...(filter.state && { state: filter.state as any }),
      ...(filter.recipientId && { recipientId: filter.recipientId }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.deliveryNote.findMany({
        where,
        include: { lines: true },
        orderBy: { deliveryNumber: 'desc' },
        skip: filter.skip ?? 0,
        take: filter.take ?? 50,
      }),
      this.prisma.deliveryNote.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  // ---- findActiveBySalesOrder ----

  async findActiveBySalesOrder(
    tenantId: string,
    salesOrderId: string,
  ): Promise<DeliveryNote[]> {
    const rows = await this.prisma.deliveryNote.findMany({
      where: {
        tenantId,
        salesOrderId,
        state: { not: 'CANCELLED' as any },
      },
      include: { lines: true },
      orderBy: { deliveryNumber: 'asc' },
    });

    return rows.map((r) => this.toDomain(r));
  }

  // ---- nextDeliveryNumber ----

  async nextDeliveryNumber(_tenantId: string): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`
      SELECT nextval('sales.delivery_note_number_seq')::bigint AS nextval
    `;
    const row = result[0];
    if (!row) throw new Error('Failed to get next delivery number from sequence');
    return Number(row.nextval);
  }

  // ---- Mapping PrismaModel ↔ DomainEntity ----

  private toDomain(row: PrismaDeliveryNoteWithLines): DeliveryNote {
    const lines = row.lines.map((l) => this.lineToDomain(l));

    return DeliveryNote.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      deliveryNumber: row.deliveryNumber,
      salesOrderId: row.salesOrderId,
      recipientId: row.recipientId,
      recipientName: row.recipientName,
      recipientCuit: row.recipientCuit,
      recipientAddress: row.recipientAddress ?? undefined,
      state: row.state as DeliveryNoteProps['state'],
      scheduledDate: row.scheduledDate ?? undefined,
      shippedDate: row.shippedDate ?? undefined,
      doneDate: row.doneDate ?? undefined,
      carrierId: row.carrierId ?? undefined,
      trackingCode: row.trackingCode ?? undefined,
      notes: row.notes ?? undefined,
      internalNotes: row.internalNotes ?? undefined,
      lockedAt: row.lockedAt ?? undefined,
      pdfPath: row.pdfPath ?? undefined,
      version: row.version,
      createdById: row.createdById,
      validatedById: row.validatedById ?? undefined,
      shippedById: row.shippedById ?? undefined,
      cancelledAt: row.cancelledAt ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lines,
    });
  }

  private lineToDomain(row: PrismaDeliveryNoteLine): DeliveryNoteLine {
    return DeliveryNoteLine.hydrate({
      id: row.id,
      tenantId: row.tenantId,
      deliveryNoteId: row.deliveryNoteId,
      salesOrderLineId: row.salesOrderLineId,
      productId: row.productId,
      lineNumber: row.lineNumber,
      description: row.description ?? undefined,
      quantity: row.quantity.toString(),
      uom: row.uom,
      unitPriceArs: row.unitPriceArs.toString(),
      stockMoveId: row.stockMoveId ?? undefined,
      serialNumbers: row.serialNumbers,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    } as DeliveryNoteLineProps);
  }
}
