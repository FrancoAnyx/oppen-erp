/**
 * Public API del módulo Core.
 *
 * Los otros módulos (Inventory, Sales, Purchases...) SOLO pueden importar
 * desde este archivo. Nunca hacer imports profundos tipo:
 *   ❌ import { PrismaEntityRepository } from '../core/infrastructure/...'
 *
 * Si necesitás algo que no está exportado acá, agregalo acá primero.
 * Esto aísla el interno del módulo y permite refactorizar sin romper consumidores.
 */

export { EntityService } from './application/entity.service';
export type {
  Entity,
  EntityRole,
  IvaCondition,
} from './domain/entities/entity';

