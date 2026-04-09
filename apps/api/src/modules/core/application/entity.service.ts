import { Inject, Injectable } from '@nestjs/common';
import { AlreadyExistsError, NotFoundError } from '@erp/shared';
import {
  Entity,
  type EntityRole,
  type IvaCondition,
} from '../../domain/entities/entity';
import {
  ENTITY_REPOSITORY,
  IEntityRepository,
} from '../../domain/repositories/entity.repository';

/**
 * Application services del módulo Core.
 *
 * Estos casos de uso NO saben nada de HTTP ni de Prisma. Solo orquestan
 * repositorios (ports) y entidades de dominio. Son triviales de testear
 * con un repo in-memory.
 */

export interface CreateEntityInput {
  tenantId: string;
  roles: EntityRole[];
  legalName: string;
  tradeName?: string;
  taxId: string;
  ivaCondition: IvaCondition;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  zipCode?: string;
  creditLimit?: string;
  paymentTermDays?: number;
  notes?: string;
}

@Injectable()
export class EntityService {
  constructor(
    @Inject(ENTITY_REPOSITORY)
    private readonly repo: IEntityRepository,
  ) {}

  async create(input: CreateEntityInput): Promise<Entity> {
    // Aggregate valida invariantes (CUIT, roles no vacíos, etc)
    const entity = Entity.create(input);

    // Unicidad: CUIT único por tenant. Chequeo explícito + fallback en DB.
    const existing = await this.repo.findByTaxId(input.tenantId, entity.taxId);
    if (existing) {
      throw new AlreadyExistsError('Entity', { taxId: entity.taxId });
    }

    return this.repo.create(entity);
  }

  async findById(tenantId: string, id: string): Promise<Entity> {
    const entity = await this.repo.findById(tenantId, id);
    if (!entity) throw new NotFoundError('Entity', id);
    return entity;
  }

  async list(params: {
    tenantId: string;
    role?: EntityRole;
    search?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Entity[]; total: number }> {
    return this.repo.findMany(params);
  }

  async updateContact(
    tenantId: string,
    id: string,
    expectedVersion: number,
    contact: { email?: string; phone?: string; address?: string },
  ): Promise<Entity> {
    const entity = await this.repo.findById(tenantId, id);
    if (!entity) throw new NotFoundError('Entity', id);

    if (entity.version !== expectedVersion) {
      // Traemos el mismo error que el repo para consistencia cuando el caller
      // no llegó siquiera a intentar el update.
      const { ConcurrencyError } = await import('@erp/shared');
      throw new ConcurrencyError('Entity', expectedVersion, entity.version);
    }

    entity.updateContactInfo(contact);
    return this.repo.update(entity);
  }

  async deactivate(tenantId: string, id: string, expectedVersion: number): Promise<void> {
    await this.repo.softDelete(tenantId, id, expectedVersion);
  }
}



