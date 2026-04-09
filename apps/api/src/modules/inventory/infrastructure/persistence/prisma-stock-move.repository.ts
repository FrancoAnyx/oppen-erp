import { Injectable } from '@nestjs/common';
import { type StockMove as PrismaStockMove, Prisma } from '@erp/database';
import { IllegalStateTransitionError, Quantity } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  StockMove,
  type StockMoveState,
  type MoveState,
  type OriginDocType,
} from '../../domain/entities/stock-move';
import { IStockMoveRepository } from '../../domain/repositories/inventory.repositories';

@Injectable()
export class PrismaStockMoveRepository implements IStockMoveRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<StockMove | null> {
    const row = await this.prisma.stockMove.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findByOrigin(
    tenantId: string,
    docType: OriginDocType,
    docId: string,
  ): Promise<StockMove[]> {
    const rows = await this.prisma.stockMove.findMany({
      where: { tenantId, originDocType: docType, originDocId: docId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findMany(params: {
    tenantId: string;
    productId?: string;
    state?: MoveState;
    locationId?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: StockMove[]; total: number }> {
    const where: Prisma.StockMoveWhereInput = {
      tenantId: params.tenantId,
      ...(params.productId ? { productId: params.productId } : {}),
      ...(params.state ? { state: params.state } : {}),
      ...(params.locationId
        ? {
            OR: [
              { sourceLocationId: params.locationId },
              { destLocationId: params.locationId },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.stockMove.findMany({
        where,
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 100, 500),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMove.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  async create(move: StockMove): Promise<StockMove> {
    const s = move.toState();
    const row = await this.prisma.stockMove.create({
      data: {
        tenantId: s.tenantId,
        productId: s.productId,
        quantity: s.quantity.toString(),
        uom: s.uom,
        sourceLocationId: s.sourceLocationId,
        destLocationId: s.destLocationId,
        state: s.state,
        originDocType: s.originDocType,
        originDocId: s.originDocId,
        originLineId: s.originLineId ?? null,
        unitCost: s.unitCost ?? null,
        unitCostUsd: s.unitCostUsd ?? null,
        fxRate: s.fxRate ?? null,
        scheduledDate: s.scheduledDate,
        doneDate: s.doneDate ?? null,
        createdById: s.createdById,
        cancelledAt: s.cancelledAt ?? null,
        cancelReason: s.cancelReason ?? null,
      },
    });
    return this.toDomain(row);
  }

  /**
   * Update de estado con protección contra race conditions.
   * En lugar de usar un `version`, usamos el estado anterior como guarda en
   * el WHERE. Esto encaja naturalmente con la state machine: una transición
   * válida siempre parte de un conjunto conocido de estados previos.
   *
   * Si otro proceso ya cambió el estado, count=0 y lanzamos un error de
   * transición ilegal.
   */
  async updateState(move: StockMove): Promise<StockMove> {
    const s = move.toState();
    // Determinar qué estados anteriores son válidos para llegar al actual.
    // Esto DEBE matchear la state machine del aggregate.
    const allowedPreviousStates = this.allowedPrevious(s.state);

    const result = await this.prisma.stockMove.updateMany({
      where: {
        id: s.id,
        tenantId: s.tenantId,
        state: { in: allowedPreviousStates },
      },
      data: {
        state: s.state,
        doneDate: s.doneDate ?? null,
        cancelledAt: s.cancelledAt ?? null,
        cancelReason: s.cancelReason ?? null,
      },
    });

    if (result.count === 0) {
      const current = await this.prisma.stockMove.findFirst({
        where: { id: s.id, tenantId: s.tenantId },
        select: { state: true },
      });
      throw new IllegalStateTransitionError(
        'StockMove',
        current?.state ?? 'UNKNOWN',
        `transition_to_${s.state}`,
      );
    }

    const updated = await this.prisma.stockMove.findFirstOrThrow({
      where: { id: s.id, tenantId: s.tenantId },
    });
    return this.toDomain(updated);
  }

  private allowedPrevious(target: MoveState): MoveState[] {
    switch (target) {
      case 'CONFIRMED':  return ['DRAFT'];
      case 'ASSIGNED':   return ['CONFIRMED'];
      case 'DONE':       return ['CONFIRMED', 'ASSIGNED'];
      case 'CANCELLED':  return ['DRAFT', 'CONFIRMED', 'ASSIGNED'];
      case 'DRAFT':      return []; // nunca volver a DRAFT
    }
  }

  private toDomain(row: PrismaStockMove): StockMove {
    const state: StockMoveState = {
      id: row.id,
      tenantId: row.tenantId,
      productId: row.productId,
      quantity: Quantity.of(row.quantity.toString()),
      uom: row.uom,
      sourceLocationId: row.sourceLocationId,
      destLocationId: row.destLocationId,
      state: row.state as MoveState,
      originDocType: row.originDocType as OriginDocType,
      originDocId: row.originDocId,
      originLineId: row.originLineId ?? undefined,
      unitCost: row.unitCost?.toString(),
      unitCostUsd: row.unitCostUsd?.toString(),
      fxRate: row.fxRate?.toString(),
      scheduledDate: row.scheduledDate,
      doneDate: row.doneDate ?? undefined,
      createdById: row.createdById,
      createdAt: row.createdAt,
      cancelledAt: row.cancelledAt ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
    };
    return StockMove.hydrate(state);
  }
}

