import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsNumberString,
  IsDateString,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
  IsInt,
  Min,
  Max,
  IsPositive,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

// =============================================================================
// Create PO
// =============================================================================

export class CreatePOLineDto {
  @IsString() @IsNotEmpty()
  productId!: string;

  @IsNumberString({ no_symbols: false })
  quantity!: string;

  @IsNumberString({ no_symbols: false })
  unitCostUsd!: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  ivaRate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  uom?: string;

  @IsOptional()
  @IsString()
  soLineOriginId?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() @IsNotEmpty()
  supplierId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePOLineDto)
  lines!: CreatePOLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  soOriginId?: string;
}

// =============================================================================
// Confirm PO
// =============================================================================

export class ConfirmPurchaseOrderDto {
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  fxRate?: string;
}

// =============================================================================
// Receive PO
// =============================================================================

export class ReceiveLineDto {
  @IsString() @IsNotEmpty()
  lineId!: string;

  @IsNumberString({ no_symbols: false })
  quantityReceived!: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  unitCostArs?: string;
}

export class ReceivePurchaseOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  fxRateAtReceipt?: string;
}

// =============================================================================
// Create PO from backorders
// =============================================================================

export class CostOverrideDto {
  @IsString() @IsNotEmpty()
  productId!: string;

  @IsNumberString({ no_symbols: false })
  unitCostUsd!: string;
}

export class CreatePOFromBackordersDto {
  @IsString() @IsNotEmpty()
  salesOrderId!: string;

  @IsString() @IsNotEmpty()
  supplierId!: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false })
  fxRateSuggested?: string;

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostOverrideDto)
  costOverrides?: CostOverrideDto[];
}

// =============================================================================
// Query params
// =============================================================================

export enum POStateFilter {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PARTIAL = 'PARTIAL',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export class ListPOQueryDto {
  @IsOptional() @IsString()
  supplierId?: string;

  @IsOptional()
  @IsEnum(POStateFilter)
  state?: POStateFilter;

  @IsOptional() @IsString()
  soOriginId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @IsPositive() @Max(200)
  take?: number;
}
