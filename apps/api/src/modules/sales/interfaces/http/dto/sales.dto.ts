import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsNumberString,
  IsPositive,
  IsInt,
  Min,
  Max,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

// =============================================================================
// Create Sales Order
// =============================================================================

export class CreateSalesOrderLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  /**
   * Cantidad como string para preservar precisión (Decimal(18,4)).
   * Ej: "10.0000", "2.5", "100"
   */
  @IsNumberString({ no_symbols: false })
  quantity!: string;

  /**
   * Precio unitario en ARS como string.
   * Ej: "125000.00"
   */
  @IsNumberString({ no_symbols: false })
  unitPriceArs!: string;

  /**
   * Descuento en % (0 a 100). Default 0.
   */
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  discountPct?: string;

  /**
   * Tasa IVA. Debe ser una de: "0.00", "10.50", "21.00", "27.00".
   */
  @IsNumberString({ no_symbols: false })
  ivaRate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  uom?: string;
}

export class CreateSalesOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'A sales order must have at least one line' })
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines!: CreateSalesOrderLineDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// =============================================================================
// Confirm Sales Order
// =============================================================================

export class ConfirmSalesOrderDto {
  /**
   * Tipo de cambio al confirmar (USD/ARS). Opcional.
   * Si se omite, se guarda null (útil para registrar el TC del día).
   */
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  fxRate?: string;

  /**
   * Si true (default), las líneas sin stock se marcan como backorder.
   * Si false, el endpoint falla si alguna línea no tiene stock.
   */
  @IsOptional()
  allowBackorder?: boolean;
}

// =============================================================================
// Cancel Sales Order
// =============================================================================

export class CancelSalesOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// =============================================================================
// Query params
// =============================================================================

export enum SalesOrderStateFilter {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PARTIAL = 'PARTIAL',
  DELIVERED = 'DELIVERED',
  INVOICED = 'INVOICED',
  CANCELLED = 'CANCELLED',
}

export class ListSalesOrdersQueryDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(SalesOrderStateFilter)
  state?: SalesOrderStateFilter;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(200)
  take?: number;
}

// =============================================================================
// Response shapes (no son DTOs de validación — son tipos de respuesta)
// =============================================================================

export interface SalesOrderLineResponse {
  id: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string;
  uom: string;
  unitPriceArs: string;
  discountPct: string;
  ivaRate: string;
  subtotalArs: string;
  taxAmountArs: string;
  totalArs: string;
  quantityDelivered: string;
  requiresBackorder: boolean;
  reserveMoveId?: string;
}

export interface SalesOrderResponse {
  id: string;
  orderNumber: number;
  customerId: string;
  state: string;
  currency: string;
  subtotalArs: string;
  taxAmountArs: string;
  totalArs: string;
  requiresBackorder: boolean;
  paymentTermDays: number;
  notes?: string;
  deliveryAddress?: string;
  fxRateAtConfirm?: string;
  version: number;
  confirmedAt?: Date;
  deliveredAt?: Date;
  invoicedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
  lines: SalesOrderLineResponse[];
}
