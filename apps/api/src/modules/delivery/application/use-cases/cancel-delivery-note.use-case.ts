// =============================================================================
// apps/api/src/modules/delivery/application/use-cases/mark-done-delivery-note.use-case.ts
// =============================================================================

import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotFoundError, BusinessRuleError } from '@erp/shared';
import {
  IDeliveryNoteRepository,
  DELIVERY_NOTE_REPOSITORY,
} from '../../domain/repositories/delivery.repositories';

export interface MarkDoneDeliveryNoteCommand {
  tenantId: string;
  deliveryNoteId: string;
  /** ID del usuario que confirma la recepción (puede ser el mismo operador) */
  confirmedById: string;
}

export interface MarkDoneDeliveryNoteResult {
  deliveryNoteId: string;
  deliveryNumber: number;
  /** Si la OV está DELIVERED, el módulo Fiscal puede emitir factura */
  salesOrderReady: boolean;
}

/**
 * MarkDoneDeliveryNoteUseCase
 *
 * SHIPPED → DONE.
 * Representa la confirmación de recepción por parte del cliente.
 * Este es el estado que habilita al módulo Fiscal para emitir la factura.
 *
 * IMPORTANTE: No lanza evento de dominio todavía (sin EventBus implementado).
 * El módulo Fiscal debe consultar remitos en estado DONE con OV en DELIVERED
 * para disparar la facturación. Esto se resuelve en Fase 2 (event-driven).
 */
@Injectable()
export class CancelDeliveryNoteUseCase {
  private readonly logger = new Logger(CancelDeliveryNoteUseCase.name);

  constructor(
    @Inject(DELIVERY_NOTE_REPOSITORY)
    private readonly deliveryRepo: IDeliveryNoteRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    cmd: CancelDeliveryNoteCommand,
  ): Promise<CancelDeliveryNoteResult> {
    const note = await this.deliveryRepo.findById(
      cmd.tenantId,
      cmd.deliveryNoteId,
    );

    if (!note) {
      throw new NotFoundError('DeliveryNote', cmd.deliveryNoteId);
    }

    // El aggregate valida que no se cancele desde SHIPPED o DONE
    note.cancel(cmd.reason, cmd.cancelledById);
    const saved = await this.deliveryRepo.update(note);

    this.logger.log(
      `DeliveryNote #${saved.deliveryNumber} cancelled — reason: "${cmd.reason}"`,
    );

    return {
      deliveryNoteId: saved.id,
      deliveryNumber: saved.deliveryNumber,
    };
  }
}
