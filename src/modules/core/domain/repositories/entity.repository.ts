import type { Entity, EntityRole } from '../entities/entity';

export const ENTITY_REPOSITORY = Symbol('ENTITY_REPOSITORY');

export interface ListEntitiesFilter {
  tenantId: string;
  role?: EntityRole;
  search?: string;
  isActive?: boolean;
  skip?: number;
  take?: number;
}

export interface IEntityRepository {
  save(entity: Entity): Promise<void>;

  findById(tenantId: string, id: string): Promise<Entity | null>;

  findByTaxId(tenantId: string, taxId: string): Promise<Entity | null>;

  list(filter: ListEntitiesFilter): Promise<{
    items: Entity[];
    total: number;
  }>;

  /**
   * Optimistic locking: hace UPDATE ... WHERE id = ? AND version = ?
   * Lanza ConcurrencyError si no matchea ninguna fila.
   */
  update(entity: Entity, expectedVersion: number): Promise<void>;

  /**
   * Soft delete via deactivate()
   */
  deactivate(tenantId: string, id: string, expectedVersion: number): Promise<void>;
}