import { Entity } from '../entities/entity';

/**
 * Port (interface) del repositorio de Entity.
 *
 * Los casos de uso dependen de esta interface, no de la implementación Prisma.
 * Esto permite:
 *   - Testear con implementaciones in-memory
 *   - Migrar a otra DB sin tocar los use cases
 *   - Mantener los módulos de dominio SIN imports de Prisma
 */
export interface IEntityRepository {
  findById(tenantId: string, id: string): Promise<Entity | null>;
  findByTaxId(tenantId: string, taxId: string): Promise<Entity | null>;

  findMany(params: {
    tenantId: string;
    role?: 'CUSTOMER' | 'SUPPLIER' | 'CARRIER';
    search?: string;
    isActive?: boolean;
    skip?: number;
    take?: number;
  }): Promise<{ items: Entity[]; total: number }>;

  /**
   * Persiste una entity NUEVA. Asigna el id y devuelve la versión con id.
   */
  create(entity: Entity): Promise<Entity>;

  /**
   * Actualiza una entity existente con optimistic locking.
   * Si el version no matchea, lanza ConcurrencyError.
   */
  update(entity: Entity): Promise<Entity>;

  /**
   * Soft-delete (marca como inactive). Para hard-delete usar otro método
   * — pero en un ERP casi nunca querés borrar referencias históricas.
   */
  softDelete(tenantId: string, id: string, expectedVersion: number): Promise<void>;
}

/**
 * Token de DI para inyectar el repositorio.
 */
export const ENTITY_REPOSITORY = Symbol('IEntityRepository');

