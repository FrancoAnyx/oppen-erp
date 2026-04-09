import {
  IsString,
  IsOptional,
  IsNumberString,
  IsEnum,
  IsInt,
  Min,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

const TRACKING_TYPES = ['NONE', 'LOT', 'SERIAL'] as const;
const COST_METHODS = ['FIFO', 'AVG', 'STD'] as const;

export class CreateProductDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^[A-Za-z0-9\-_.]+$/, { message: 'Invalid SKU format' })
  sku!: string;

  @IsString() @Length(1, 500) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsOptional() @IsEnum(TRACKING_TYPES) tracking?: (typeof TRACKING_TYPES)[number];
  @IsOptional() @IsNumberString() ivaRate?: string;
  @IsOptional() @IsEnum(COST_METHODS) costMethod?: (typeof COST_METHODS)[number];
  @IsOptional() @IsNumberString() standardCostUsd?: string;
  @IsOptional() @IsNumberString() listPriceArs?: string;
  @IsOptional() @IsNumberString() weightKg?: string;
  @IsOptional() @IsString() uom?: string;
}

export class UpdateListPriceDto {
  @IsInt() @Min(1) version!: number;
  @IsNumberString() listPriceArs!: string;
}

export class ReserveStockDto {
  @IsString() productId!: string;
  @IsNumberString() quantity!: string;
  @IsOptional() @IsString() sourceLocationId?: string;
  @IsString() originDocId!: string;
  @IsOptional() @IsString() originLineId?: string;
}

export class ReceiveStockDto {
  @IsString() productId!: string;
  @IsNumberString() quantity!: string;
  @IsString() destLocationId!: string;
  @IsString() originDocId!: string;
  @IsOptional() @IsNumberString() unitCost?: string;
  @IsOptional() @IsNumberString() unitCostUsd?: string;
  @IsOptional() @IsNumberString() fxRate?: string;
}

export class ListProductsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) isActive?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) take?: number;
}
