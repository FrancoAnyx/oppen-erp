import { Injectable } from '@nestjs/common';
import { Prisma, type Entity as PrismaEntity } from '@erp/database';
import { ConcurrencyError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import {
  Entity,
  type EntityState,
  type EntityRole,
  type IvaCondition,
} from '../../domain/entities/entity';
import { IEntityRepository } from '../../domain/repositories/entity.repository';

@Injectable()
export class PrismaEntityRepository implements IEntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Queries ----

  async findById(tenantId: string, id: string): Promise<Entity | null> {
    const row = await this.prisma.entity.findFirst({
      where: { id, tenantId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByTaxId(tenantId: string, taxId: string): Promise<Entity | null> {
    const row = await this.prisma.entity.findUnique({
      where: { tenantId_taxId: { tenantId, taxId } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findMany(params: {
    tenantId: string;
    role?: EntityRole;
    search?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Entity[]; total: number }> {
    const where: Prisma.EntityWhereInput = {
      tenantId: params.tenantId,
      ...(params.role ? { entityType: { has: params.role } } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.search
        ? {
            OR: [
              { legalName: { contains: params.search, mode: 'insensitive' } },
              { tradeName: { contains: params.search, mode: 'insensitive' } },
              { taxId: { contains: params.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.entity.findMany({
        where,
        skip: params.skip ?? 0,
        take: Math.min(params.take ?? 50, 200),
        orderBy: { legalName: 'asc' },
      }),
      this.prisma.entity.count({ where }),
    ]);

    return { items: rows.map((r) => this.toDomain(r)), total };
  }

  // ---- Writes ----

  async create(entity: Entity): Promise<Entity> {
    const s = entity.toState();
    const created = await this.prisma.entity.create({
      data: {
        tenantId: s.tenantId,
        entityType: s.roles,
        legalName: s.legalName,
        tradeName: s.tradeName ?? null,
        taxId: s.taxId,
        ivaCondition: s.ivaCondition,
        email: s.email ?? null,
        phone: s.phone ?? null,
        address: s.address ?? null,
        city: s.city ?? null,
        province: s.province ?? null,
        zipCode: s.zipCode ?? null,
        creditLimit: s.creditLimit ?? '0',
        paymentTermDays: s.paymentTermDays ?? 0,
        notes: s.notes ?? null,
        isActive: s.isActive,
        version: 1,
      },
    });
    return this.toDomain(created);
  }

  /**
   * Update con optimistic locking: la cláusula WHERE incluye `version` y
   * el UPDATE incrementa `version`. Si la fila no existe o version cambió,
   * `updateMany` devuelve count=0 y lanzamos ConcurrencyError.
   */
  async update(entity: Entity): Promise<Entity> {
    const s = entity.toState();
    const result = await this.prisma.entity.updateMany({
      where: { id: s.id, tenantId: s.tenantId, version: s.version },
      data: {
        entityType: s.roles,
        legalName: s.legalName,
        tradeName: s.tradeName ?? null,
        ivaCondition: s.ivaCondition,
        email: s.email ?? null,
        phone: s.phone ?? null,
        address: s.address ?? null,
        city: s.city ?? null,
        province: s.province ?? null,
        zipCode: s.zipCode ?? null,
        creditLimit: s.creditLimit ?? '0',
        paymentTermDays: s.paymentTermDays ?? 0,
        notes: s.notes ?? null,
        isActive: s.isActive,
        padronData: (s.padronData ?? null) as any,
        padronSyncedAt: s.padronSyncedAt ?? null,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      // Pudo ser: fila no existe, o version cambió. Consultamos version actual
      // para dar un mensaje más informativo.
      const current = await this.prisma.entity.findFirst({
        where: { id: s.id, tenantId: s.tenantId },
        select: { version: true },
      });
      throw new ConcurrencyError('Entity', s.version, current?.version ?? -1);
    }

    const updated = await this.prisma.entity.findFirstOrThrow({
      where: { id: s.id, tenantId: s.tenantId },
    });
    return this.toDomain(updated);
  }

  async softDelete(tenantId: string, id: string, expectedVersion: number): Promise<void> {
    const result = await this.prisma.entity.updateMany({
      where: { id, tenantId, version: expectedVersion },
      data: { isActive: false, version: { increment: 1 } },
    });
    if (result.count === 0) {
      const current = await this.prisma.entity.findFirst({
        where: { id, tenantId },
        select: { version: true },
      });
      throw new ConcurrencyError('Entity', expectedVersion, current?.version ?? -1);
    }
  }

  // ---- Mapping ----

  private toDomain(row: PrismaEntity): Entity {
    const state: EntityState = {
      id: row.id,
      tenantId: row.tenantId,
      roles: row.entityType as EntityRole[],
      legalName: row.legalName,
      tradeName: row.tradeName ?? undefined,
      taxId: row.taxId,
      ivaCondition: row.ivaCondition as IvaCondition,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      city: row.city ?? undefined,
      province: row.province ?? undefined,
      zipCode: row.zipCode ?? undefined,
      creditLimit: row.creditLimit.toString(),
      paymentTermDays: row.paymentTermDays,
      notes: row.notes ?? undefined,
      isActive: row.isActive,
      version: row.version,
      padronData: row.padronData as Record<string, unknown> | null,
      padronSyncedAt: row.padronSyncedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    return Entity.hydrate(state);
  }
}


