import { Module } from '@nestjs/common';
import { CreateDeliveryNoteUseCase }    from './application/use-cases/create-delivery-note.use-case';
import { ShipDeliveryNoteUseCase }      from './application/use-cases/ship-delivery-note.use-case';
import { MarkDoneDeliveryNoteUseCase }  from './application/use-cases/mark-done-delivery-note.use-case';
import { CancelDeliveryNoteUseCase }    from './application/use-cases/cancel-delivery-note.use-case';
import { DeliveryController }           from './interfaces/http/delivery.controller';
import { PrismaDeliveryNoteRepository } from './infrastructure/persistence/prisma-delivery.repository';

export const DELIVERY_NOTE_REPOSITORY = Symbol('IDeliveryNoteRepository');

@Module({
  controllers: [DeliveryController],
  providers: [
    CreateDeliveryNoteUseCase,
    ShipDeliveryNoteUseCase,
    MarkDoneDeliveryNoteUseCase,
    CancelDeliveryNoteUseCase,
    { provide: DELIVERY_NOTE_REPOSITORY, useClass: PrismaDeliveryNoteRepository },
  ],
  exports: [
    CreateDeliveryNoteUseCase,
    ShipDeliveryNoteUseCase,
    MarkDoneDeliveryNoteUseCase,
    CancelDeliveryNoteUseCase,
  ],
})
export class DeliveryModule {}
