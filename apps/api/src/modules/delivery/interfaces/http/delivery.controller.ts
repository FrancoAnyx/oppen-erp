// =============================================================================
// apps/api/src/modules/delivery/interfaces/http/delivery.controller.ts
// =============================================================================

import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { NotFoundError } from '@erp/shared';
import { CurrentTenant } from '../../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../../modules/auth/domain/jwt-payload.interface';
import { CreateDeliveryNoteUseCase } from '../../application/use-cases/create-delivery-note.use-case';
import { ShipDeliveryNoteUseCase } from '../../application/use-cases/ship-delivery-note.use-case';
import { MarkDoneDeliveryNoteUseCase } from '../../application/use-cases/mark-done-delivery-note.use-case';
import { CancelDeliveryNoteUseCase } from '../../application/use-cases/cancel-delivery-note.use-case';
import {
  DELIVERY_NOTE_REPOSITORY,
  IDeliveryNoteRepository,
} from '../../domain/repositories/delivery.repositories';
import {
  CreateDeliveryNoteDto,
  ShipDeliveryNoteDto,
  CancelDeliveryNoteDto,
  ListDeliveryNotesQueryDto,
  type DeliveryNoteResponse,
  type DeliveryNoteLineResponse,
} from './dto/delivery.dto';
import type { DeliveryNote } from '../../domain/entities/delivery-note';

// ---- Mapper domain → response -----------------------------------------------

function noteToResponse(note: DeliveryNote): DeliveryNoteResponse {
  const props = note.toProps();
  return {
    id: props.id,
    deliveryNumber: props.deliveryNumber,
    salesOrderId: props.salesOrderId,
    recipientId: props.recipientId,
    recipientName: props.recipientName,
    recipientCuit: props.recipientCuit,
    recipientAddress: props.recipientAddress,
    state: props.state,
    scheduledDate: props.scheduledDate,
    shippedDate: props.shippedDate,
    doneDate: props.doneDate,
    carrierId: props.carrierId,
    trackingCode: props.trackingCode,
    notes: props.notes,
    lockedAt: props.lockedAt,
    version: props.version,
    createdById: props.createdById,
    cancelledAt: props.cancelledAt,
    cancelReason: props.cancelReason,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    lines: props.lines.map(
      (l): DeliveryNoteLineResponse => ({
        id: l.id,
        salesOrderLineId: l.salesOrderLineId,
        productId: l.productId,
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPriceArs: l.unitPriceArs,
        stockMoveId: l.stockMoveId,
        serialNumbers: l.serialNumbers,
      }),
    ),
  };
}

// ---- Controller -------------------------------------------------------------

@ApiTags('delivery')
@ApiBearerAuth('JWT')
@Controller('delivery-notes')
export class DeliveryController {
  constructor(
    private readonly createUC: CreateDeliveryNoteUseCase,
    private readonly shipUC: ShipDeliveryNoteUseCase,
    private readonly markDoneUC: MarkDoneDeliveryNoteUseCase,
    private readonly cancelUC: CancelDeliveryNoteUseCase,
    @Inject(DELIVERY_NOTE_REPOSITORY)
    private readonly deliveryRepo: IDeliveryNoteRepository,
  ) {}

  /**
   * POST /delivery-notes
   * Crea un remito en estado DRAFT.
   * Valida que las cantidades no superen el pendiente de la OV.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear remito en borrador' })
  @ApiResponse({ status: 201, description: 'Remito creado' })
  @ApiResponse({ status: 422, description: 'Error de negocio (qty, estado OV, etc)' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDeliveryNoteDto,
  ): Promise<{ deliveryNoteId: string; deliveryNumber: number }> {
    return this.createUC.execute({
      tenantId,
      salesOrderId: dto.salesOrderId,
      createdById: user.sub,
      lines: dto.lines.map((l) => ({
        salesOrderLineId: l.salesOrderLineId,
        productId: l.productId,
        quantity: l.quantity,
        uom: l.uom,
        description: l.description,
        serialNumbers: l.serialNumbers,
      })),
      scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
      carrierId: dto.carrierId,
      notes: dto.notes,
    });
  }

  /**
   * GET /delivery-notes
   * Lista remitos con filtros opcionales.
   */
  @Get()
  @ApiOperation({ summary: 'Listar remitos' })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListDeliveryNotesQueryDto,
  ): Promise<{ items: DeliveryNoteResponse[]; total: number }> {
    const { items, total } = await this.deliveryRepo.findMany({
      tenantId,
      salesOrderId: query.salesOrderId,
      state: query.state as any,
      recipientId: query.recipientId,
      skip: query.skip,
      take: query.take,
    });

    return { items: items.map(noteToResponse), total };
  }

  /**
   * GET /delivery-notes/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener remito por ID' })
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ): Promise<DeliveryNoteResponse> {
    const note = await this.deliveryRepo.findById(tenantId, id);
    if (!note) throw new NotFoundError('DeliveryNote', id);
    return noteToResponse(note);
  }

  /**
   * GET /delivery-notes/by-sales-order/:salesOrderId
   * Lista todos los remitos de una OV (útil para el panel de la OV).
   */
  @Get('by-sales-order/:salesOrderId')
  @ApiOperation({ summary: 'Remitos de una orden de venta' })
  async findBySalesOrder(
    @CurrentTenant() tenantId: string,
    @Param('salesOrderId') salesOrderId: string,
  ): Promise<DeliveryNoteResponse[]> {
    const notes = await this.deliveryRepo.findActiveBySalesOrder(
      tenantId,
      salesOrderId,
    );
    return notes.map(noteToResponse);
  }

  /**
   * PATCH /delivery-notes/:id/ship
   * Despacha el remito: mueve stock DONE y actualiza la OV.
   * Una vez ejecutado, el remito queda INMUTABLE (lockedAt seteado).
   */
  @Patch(':id/ship')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Despachar remito (SHIPPED) — inmutable desde acá' })
  @ApiResponse({ status: 200, description: 'Remito despachado, stock actualizado' })
  @ApiResponse({ status: 409, description: 'Conflicto de concurrencia — refrescar y reintentar' })
  async ship(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ShipDeliveryNoteDto,
  ) {
    return this.shipUC.execute({
      tenantId,
      deliveryNoteId: id,
      shippedById: user.sub,
      shippedDate: dto.shippedDate ? new Date(dto.shippedDate) : undefined,
    });
  }

  /**
   * PATCH /delivery-notes/:id/done
   * Marca el remito como DONE (receptor confirmó).
   * Habilita la facturación electrónica desde el módulo Fiscal.
   */
  @Patch(':id/done')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar recepción (DONE) — habilita facturación' })
  async markDone(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.markDoneUC.execute({
      tenantId,
      deliveryNoteId: id,
      confirmedById: user.sub,
    });
  }

  /**
   * PATCH /delivery-notes/:id/cancel
   * Cancela el remito (solo DRAFT o VALIDATED).
   * Para cancelar un SHIPPED, crear un RMA.
   */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar remito (solo DRAFT o VALIDATED)' })
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelDeliveryNoteDto,
  ) {
    return this.cancelUC.execute({
      tenantId,
      deliveryNoteId: id,
      cancelledById: user.sub,
      reason: dto.reason,
    });
  }
}
