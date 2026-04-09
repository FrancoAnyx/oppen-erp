import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotFoundError } from '@erp/shared';
import { CurrentTenant } from '../../../../infrastructure/http/current-tenant.decorator';
import { CurrentUser } from '../../../auth/public-api';
import type { JwtPayload } from '../../../auth/public-api';
import { CreatePurchaseOrderUseCase } from '../../application/use-cases/create-purchase-order.use-case';
import { ConfirmPurchaseOrderUseCase } from '../../application/use-cases/confirm-purchase-order.use-case';
import { ReceivePurchaseOrderUseCase } from '../../application/use-cases/receive-purchase-order.use-case';
import { CreatePOFromBackordersUseCase } from '../../application/use-cases/create-po-from-backorders.use-case';
import {
  PURCHASE_ORDER_REPOSITORY,
  IPurchaseOrderRepository,
} from '../../domain/repositories/purchases.repositories';
import {
  CreatePurchaseOrderDto,
  ConfirmPurchaseOrderDto,
  ReceivePurchaseOrderDto,
  CreatePOFromBackordersDto,
  ListPOQueryDto,
} from './dto/purchases.dto';
import type { PurchaseOrder } from '../../domain/entities/purchase-order';

function poToResponse(po: PurchaseOrder) {
  const s = po.toState();
  return {
    id: s.id,
    orderNumber: s.orderNumber,
    supplierId: s.supplierId,
    state: s.state,
    currency: s.currency,
    subtotalUsd: s.subtotalUsd,
    taxAmountUsd: s.taxAmountUsd,
    totalUsd: s.totalUsd,
    totalArs: s.totalArs,
    fxRateAtConfirm: s.fxRateAtConfirm,
    expectedDate: s.expectedDate,
    soOriginId: s.soOriginId,
    notes: s.notes,
    version: s.version,
    confirmedAt: s.confirmedAt,
    receivedAt: s.receivedAt,
    cancelledAt: s.cancelledAt,
    cancelReason: s.cancelReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lines: s.lines.map((l) => {
      const lp = l.toProps();
      return {
        id: lp.id,
        productId: lp.productId,
        lineNumber: lp.lineNumber,
        description: lp.description,
        quantity: lp.quantity,
        uom: lp.uom,
        unitCostUsd: lp.unitCostUsd,
        ivaRate: lp.ivaRate,
        subtotalUsd: lp.subtotalUsd,
        taxAmountUsd: lp.taxAmountUsd,
        totalUsd: lp.totalUsd,
        quantityReceived: lp.quantityReceived,
        incomingMoveId: lp.incomingMoveId,
        soLineOriginId: lp.soLineOriginId,
      };
    }),
  };
}

@Controller('purchase-orders')
export class PurchasesController {
  constructor(
    private readonly createUC: CreatePurchaseOrderUseCase,
    private readonly confirmUC: ConfirmPurchaseOrderUseCase,
    private readonly receiveUC: ReceivePurchaseOrderUseCase,
    private readonly backorderUC: CreatePOFromBackordersUseCase,
    @Inject(PURCHASE_ORDER_REPOSITORY)
    private readonly poRepo: any,
  ) {}

  /** POST /purchase-orders — crea OC en DRAFT */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.createUC.execute({
      tenantId,
      supplierId: dto.supplierId,
      createdById: user.sub,
      currency: dto.currency,
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
      deliveryAddress: dto.deliveryAddress,
      notes: dto.notes,
      soOriginId: dto.soOriginId,
      lines: dto.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCostUsd: l.unitCostUsd,
        ivaRate: l.ivaRate,
        description: l.description,
        uom: l.uom,
        soLineOriginId: l.soLineOriginId,
      })),
    });
  }

  /** GET /purchase-orders */
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListPOQueryDto,
  ) {
    const { items, total } = await this.poRepo.findMany({
      tenantId,
      supplierId: query.supplierId,
      state: query.state,
      soOriginId: query.soOriginId,
      skip: query.skip,
      take: query.take,
    });
    return { items: items.map(poToResponse), total };
  }

  /** GET /purchase-orders/:id */
  @Get(':id')
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const po = await this.poRepo.findById(tenantId, id);
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    return poToResponse(po);
  }

  /** PATCH /purchase-orders/:id/confirm — crea Incoming stock moves */
  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ConfirmPurchaseOrderDto,
  ) {
    return this.confirmUC.execute({
      tenantId,
      orderId: id,
      confirmedById: user.sub,
      fxRate: dto.fxRate,
    });
  }

  /** PATCH /purchase-orders/:id/receive — recibe mercadería (total o parcial) */
  @Patch(':id/receive')
  @HttpCode(HttpStatus.OK)
  async receive(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.receiveUC.execute({
      tenantId,
      orderId: id,
      receivedById: user.sub,
      lines: dto.lines,
      fxRateAtReceipt: dto.fxRateAtReceipt,
    });
  }

  /**
   * POST /purchase-orders/from-backorders
   * Genera una OC sugerida desde los backorders de una OV (back-to-back).
   */
  @Post('from-backorders')
  @HttpCode(HttpStatus.CREATED)
  async createFromBackorders(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePOFromBackordersDto,
  ) {
    return this.backorderUC.execute({
      tenantId,
      salesOrderId: dto.salesOrderId,
      supplierId: dto.supplierId,
      createdById: user.sub,
      fxRateSuggested: dto.fxRateSuggested,
      expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
      costOverrides: dto.costOverrides,
    });
  }
}




