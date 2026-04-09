import { Module } from '@nestjs/common';
import { EntityService } from './application/entity.service';
import { ENTITY_REPOSITORY } from './domain/repositories/entity.repository';
import { PrismaEntityRepository } from './infrastructure/persistence/prisma-entity.repository';
import { EntityController } from './interfaces/http/entity.controller';

/**
 * CoreModule — bounded context de identidad, tenants, users y entidades.
 *
 * Solo exporta:
 *   - EntityService: para que otros módulos puedan validar clientes/proveedores
 *     (ej: Sales al crear una OV)
 *
 * Todo lo demás es interno. Los otros módulos NO pueden importar directamente
 * PrismaEntityRepository ni las entities de dominio. Si lo necesitan, es señal
 * de que hay que agregar un método al EntityService.
 */
@Module({
  controllers: [EntityController],
  providers: [
    EntityService,
    {
      provide: ENTITY_REPOSITORY,
      useClass: PrismaEntityRepository,
    },
  ],
  exports: [EntityService],
})
export class CoreModule {}

