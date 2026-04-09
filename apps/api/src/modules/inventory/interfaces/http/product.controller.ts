import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Quantity } from '@erp/shared';
import { ProductService } from '../../application/product.service';
import { StockCalculatorService } from '../../application/services/stock-calculator.service';
import { StockReservationService } from '../../application/services/stock-reservation.service';
import { StockReceiptService } from '../../application/services/stock-receipt.service';
import { CurrentTenant } from '../../../../infrastructure/http/current-tenant.decorator';
import {
  CreateProductDto,
  UpdateListPriceDto,
  ListProductsQueryDto,
  ReserveStockDto,
  ReceiveStockDto,
} from './dto/inventory.dto';
import type { Product } from '../../domain/entities/product';
import type { StockQuantities } from '../../domain/value-objects/stock-quantities';

function productToResponse(p: Product, stock?: StockQuantities) {
  const s = p.toState();
  return {
    id: s.id,
    sku: s.sku,
    name: s.name,
    description: s.description,
    barcode: s.barcode,
    categoryId: s.categoryId,
    tracking: s.tracking,
    ivaRate: s.ivaRate,
    standardCostUsd: s.standardCostUsd,
    listPriceArs: s.listPriceArs,
    uom: s.uom,
    isActive: s.isActive,
    version: s.version,
    stock: stock?.toJSON(),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Nota: hay que cablear esto a un user real al meter auth
const SEED_USER_ID = 'will-be-replaced-by-auth';

@Controller('products')
export class ProductController {
  constructor(
    private readonly products: ProductService,
    private readonly calculator: StockCalculatorService,
    private readonly reservation: StockReservationService,
    private readonly receipt: StockReceiptService,
  ) {}

  @Post()
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateProductDto) {
    const product = await this.products.create({ tenantId, ...dto });
    return productToResponse(product, undefined);
  }

  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListProductsQueryDto,
  ) {
    const { items, total } = await this.products.list({ tenantId, ...query });

    // Bulk stock para evitar N+1
    const stockMap = await this.calculator.getTotalStockBulk(
      tenantId,
      items.map((p) => p.id),
    );

    return {
      items: items.map((p) => productToResponse(p, stockMap.get(p.id))),
      total,
      skip: query.skip ?? 0,
      take: query.take ?? 50,
    };
  }

  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const product = await this.products.findById(tenantId, id);
    const stock = await this.calculator.getTotalStock(tenantId, id);
    return productToResponse(product, stock);
  }

  @Patch(':id/list-price')
  async updatePrice(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateListPriceDto,
  ) {
    const product = await this.products.updateListPrice(
      tenantId,
      id,
      dto.version,
      dto.listPriceArs,
    );
    return productToResponse(product);
  }

  // ---- Stock operations ----

  @Post('stock/receive')
  async receive(
    @CurrentTenant() tenantId: string,
    @Body() dto: ReceiveStockDto,
  ) {
    const result = await this.receipt.receiveDirect({
      tenantId,
      productId: dto.productId,
      quantity: Quantity.of(dto.quantity),
      destLocationId: dto.destLocationId,
      originDocType: 'RECEIPT',
      originDocId: dto.originDocId,
      unitCost: dto.unitCost,
      unitCostUsd: dto.unitCostUsd,
      fxRate: dto.fxRate,
      createdById: SEED_USER_ID,
    });
    return { moveId: result.moveId };
  }

  @Post('stock/reserve')
  async reserve(
    @CurrentTenant() tenantId: string,
    @Body() dto: ReserveStockDto,
  ) {
    // El controller SOLO traduce HTTP → dominio. El service resuelve las
    // locations virtuales y los defaults de warehouse.
    const result = await this.reservation.reserveForCustomer({
      tenantId,
      productId: dto.productId,
      quantity: Quantity.of(dto.quantity),
      sourceLocationId: dto.sourceLocationId,
      originDocType: 'SO',
      originDocId: dto.originDocId,
      originLineId: dto.originLineId,
      createdById: SEED_USER_ID,
    });
    return { moveId: result.moveId };
  }
}

