import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotFoundError } from '@erp/shared';
import { CurrentTenant } from '../../../../infrastructure/http/current-tenant.decorator';
import { CurrentUser } from '../../../auth/public-api';
import type { JwtPayload } from '../../../auth/public-api';
import { CreateSalesOrderUseCase } from '../../application/use-cases/create-sales-order.use-case';
import { ConfirmSalesOrderUseCase } from '../../application/use-cases/confirm-sales-order.use-case';
import { CancelSalesOrderUseCase } from '../../application/use-cases/cancel-sales-order.use-case';
import {
  ISalesOrderRepository,
  SALES_ORDER_REPOSITORY,
} from '../../domain/repositories/sales.repositories';
import {
  CreateSalesOrderDto,
  ConfirmSalesOrderDto,
  CancelSalesOrderDto,
  ListSalesOrdersQueryDto,
  type SalesOrderResponse,
  type SalesOrderLineResponse,
} from './dto/sales.dto';
import { Inject } from '@nestjs/common';
import type { SalesOrder } from '../../domain/entities/sales-order';

// ---------------------------------------------------------------------------
// Helpers de mapping dominio → respuesta HTTP
// ---------------------------------------------------------------------------

function orderToResponse(order: SalesOrder): SalesOrderResponse {
  const s = order.toState();
  return {
    id: s.id,
    orderNumber: s.orderNumber,
    customerId: s.customerId,
    state: s.state,
    currency: s.currency,
    subtotalArs: s.subtotalArs,
    taxAmountArs: s.taxAmountArs,
    totalArs: s.totalArs,
    requiresBackorder: s.requiresBackorder,
    paymentTermDays: s.paymentTermDays,
    notes: s.notes,
    deliveryAddress: s.deliveryAddress,
    fxRateAtConfirm: s.fxRateAtConfirm,
    version: s.version,
    confirmedAt: s.confirmedAt,
    deliveredAt: s.deliveredAt,
    invoicedAt: s.invoicedAt,
    cancelledAt: s.cancelledAt,
    cancelReason: s.cancelReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lines: s.lines.map((l): SalesOrderLineResponse => {
      const lp = l.toProps();
      return {
        id: lp.id,
        productId: lp.productId,
        lineNumber: lp.lineNumber,
        description: lp.description,
        quantity: lp.quantity,
        uom: lp.uom,
        unitPriceArs: lp.unitPriceArs,
        discountPct: lp.discountPct,
        ivaRate: lp.ivaRate,
        subtotalArs: lp.subtotalArs,
        taxAmountArs: lp.taxAmountArs,
        totalArs: lp.totalArs,
        quantityDelivered: lp.quantityDelivered,
        requiresBackorder: lp.requiresBackorder,
        reserveMoveId: lp.reserveMoveId,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('sales-orders')
export class SalesController {
  constructor(
    private readonly createUC: CreateSalesOrderUseCase,
    private readonly confirmUC: ConfirmSalesOrderUseCase,
    private readonly cancelUC: CancelSalesOrderUseCase,
    @Inject(SALES_ORDER_REPOSITORY)
    private readonly salesOrderRepo: any,
  ) {}

  /**
   * POST /sales-orders
   * Crea una OV en estado DRAFT.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesOrderDto,
  ): Promise<{ orderId: string; orderNumber: number }> {
    return this.createUC.execute({
      tenantId,
      customerId: dto.customerId,
      createdById: user.sub,
      paymentTermDays: dto.paymentTermDays,
      deliveryAddress: dto.deliveryAddress,
      notes: dto.notes,
      lines: dto.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPriceArs: l.unitPriceArs,
        discountPct: l.discountPct,
        ivaRate: l.ivaRate,
        description: l.description,
        uom: l.uom,
      })),
    });
  }

  /**
   * GET /sales-orders
   * Lista OVs con filtros opcionales.
   */
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListSalesOrdersQueryDto,
  ): Promise<{ items: SalesOrderResponse[]; total: number }> {
    const { items, total } = await this.salesOrderRepo.findMany({
      tenantId,
      customerId: query.customerId,
      state: query.state,
      search: query.search,
      skip: query.skip,
      take: query.take,
    });

    return { items: items.map(orderToResponse), total };
  }

  /**
   * GET /sales-orders/:id
   * Obtiene una OV con todas sus líneas.
   */
  @Get(':id')
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ): Promise<SalesOrderResponse> {
    const order = await this.salesOrderRepo.findById(tenantId, id);
    if (!order) throw new NotFoundError('SalesOrder', id);
    return orderToResponse(order);
  }

  /**
   * PATCH /sales-orders/:id/confirm
   * Confirma la OV: reserva stock, transiciona a CONFIRMED.
   *
   * Retorna 200 con el resultado de la confirmación, incluyendo si hubo
   * líneas que quedaron en backorder.
   */
  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmSalesOrderDto,
  ) {
    return this.confirmUC.execute({
      tenantId,
      orderId: id,
      confirmedById: user.sub,
      fxRate: dto.fxRate,
      allowBackorder: dto.allowBackorder,
    });
  }

  /**
   * PATCH /sales-orders/:id/cancel
   * Cancela la OV y libera reservas de stock.
   */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelSalesOrderDto,
  ): Promise<void> {
    await this.cancelUC.execute({
      tenantId,
      orderId: id,
      cancelledById: user.sub,
      reason: dto.reason,
    });
  }
}




