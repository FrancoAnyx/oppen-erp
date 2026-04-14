import { Module } from '@nestjs/common';
import { CreateDeliveryNoteUseCase } from './application/use-cases/create-delivery-note.use-case';
import { ShipDeliveryNoteUseCase }   from './application/use-cases/ship-delivery-note.use-case';
import { DeliveryController }        from './interfaces/http/delivery.controller';
import { PrismaDeliveryRepository }  from './infrastructure/persistence/prisma-delivery.repository';

export const DELIVERY_NOTE_REPOSITORY = Symbol('IDeliveryNoteRepository');

@Module({
  controllers: [DeliveryController],
  providers: [
    CreateDeliveryNoteUseCase,
    ShipDeliveryNoteUseCase,
    { provide: DELIVERY_NOTE_REPOSITORY, useClass: PrismaDeliveryRepository },
  ],
  exports: [CreateDeliveryNoteUseCase, ShipDeliveryNoteUseCase],
})
export class DeliveryModule {}
