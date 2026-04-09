import { Injectable } from '@nestjs/common';
import { type Location as PrismaLocation } from '@erp/database';
import { NotFoundError } from '@erp/shared';
import { PrismaService } from '../../../../infrastructure/database/prisma.service';
import { Location, type LocationState, type LocationType } from '../../domain/entities/location';
import { ILocationRepository } from '../../domain/repositories/inventory.repositories';

@Injectable()
export class PrismaLocationRepository implements ILocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, id: string): Promise<Location | null> {
    const row = await this.prisma.location.findFirst({ where: { id, tenantId } });
    return row ? this.toDomain(row) : null;
  }

  async findByCode(tenantId: string, code: string): Promise<Location | null> {
    const row = await this.prisma.location.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByType(tenantId: string, type: LocationType): Promise<Location[]> {
    const rows = await this.prisma.location.findMany({
      where: { tenantId, locationType: type, isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async findAll(tenantId: string): Promise<Location[]> {
    const rows = await this.prisma.location.findMany({
      where: { tenantId },
      orderBy: [{ locationType: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => this.toDomain(r));
  }

  async create(location: Location): Promise<Location> {
    const s = location.toState();
    const row = await this.prisma.location.create({
      data: {
        tenantId: s.tenantId,
        code: s.code,
        name: s.name,
        locationType: s.locationType,
        parentId: s.parentId ?? null,
        isActive: s.isActive,
      },
    });
    return this.toDomain(row);
  }

  /**
   * Devuelve la primera location activa del tipo. En single-tenant y con el
   * seed provisto, siempre debería haber exactamente una de cada tipo virtual.
   */
  async getDefaultByType(tenantId: string, type: LocationType): Promise<Location> {
    const row = await this.prisma.location.findFirst({
      where: { tenantId, locationType: type, isActive: true },
      orderBy: { code: 'asc' },
    });
    if (!row) {
      throw new NotFoundError('Location', { locationType: type });
    }
    return this.toDomain(row);
  }

  private toDomain(row: PrismaLocation): Location {
    const state: LocationState = {
      id: row.id,
      tenantId: row.tenantId,
      code: row.code,
      name: row.name,
      locationType: row.locationType as LocationType,
      parentId: row.parentId ?? undefined,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
    return Location.hydrate(state);
  }
}

