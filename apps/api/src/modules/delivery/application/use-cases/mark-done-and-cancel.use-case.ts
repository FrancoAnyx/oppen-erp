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
export class MarkDoneDeliveryNoteUseCase {
  private readonly logger = new Logger(MarkDoneDeliveryNoteUseCase.name);

  constructor(
    @Inject(DELIVERY_NOTE_REPOSITORY)
    private readonly deliveryRepo: IDeliveryNoteRepository,
    // PrismaService para consultar estado de la OV
    // (no usamos SalesModule para no crear dependencia circular)
  ) {}

  async execute(
    cmd: MarkDoneDeliveryNoteCommand,
  ): Promise<MarkDoneDeliveryNoteResult> {
    const note = await this.deliveryRepo.findById(
      cmd.tenantId,
      cmd.deliveryNoteId,
    );

    if (!note) {
      throw new NotFoundError('DeliveryNote', cmd.deliveryNoteId);
    }

    if (note.currentState !== 'SHIPPED') {
      throw new BusinessRuleError(
        'DN_MUST_BE_SHIPPED_TO_DONE',
        `Cannot mark delivery note as DONE from state "${note.currentState}"`,
        {
          deliveryNoteId: cmd.deliveryNoteId,
          state: note.currentState,
        },
      );
    }

    note.markDone();
    const saved = await this.deliveryRepo.update(note);

    this.logger.log(
      `DeliveryNote #${saved.deliveryNumber} marked DONE — salesOrderId=${saved.salesOrderId}`,
    );

    // salesOrderReady = true significa que el módulo Fiscal puede revisar
    // si la OV está en DELIVERED para emitir la factura.
    // La lógica real de "¿todos los remitos están DONE?" queda en FiscalModule.
    return {
      deliveryNoteId: saved.id,
      deliveryNumber: saved.deliveryNumber,
      salesOrderReady: true,
    };
  }
}

// =============================================================================
// apps/api/src/modules/delivery/application/use-cases/cancel-delivery-note.use-case.ts
// =============================================================================

import { PrismaService } from '../../../../infrastructure/database/prisma.service';

export interface CancelDeliveryNoteCommand {
  tenantId: string;
  deliveryNoteId: string;
  cancelledById: string;
  reason: string;
}

export interface CancelDeliveryNoteResult {
  deliveryNoteId: string;
  deliveryNumber: number;
}

/**
 * CancelDeliveryNoteUseCase
 *
 * DRAFT | VALIDATED → CANCELLED.
 * No se puede cancelar desde SHIPPED (ya salió del depósito — crear RMA).
 *
 * SIDE EFFECTS:
 *   - Si el remito estaba en VALIDATED, los stockMoves en ASSIGNED deben
 *     volver a CONFIRMED (la reserva se mantiene, solo se libera la asignación).
 *     Por ahora esta lógica es simple: en DRAFT/VALIDATED no hay moves DONE,
 *     así que no hay nada que revertir en el stock.
 *
 * NOTA FUTURA: Cuando implementemos la transición DRAFT→VALIDATED con
 * creación de moves ASSIGNED, habrá que cancelarlos aquí.
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
