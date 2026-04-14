// =============================================================================
// apps/api/src/modules/delivery/interfaces/http/dto/delivery.dto.ts
// =============================================================================

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  IsNumberString,
  IsEnum,
  IsInt,
  IsPositive,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DeliveryNoteState } from '../../../domain/entities/delivery-note';

// =============================================================================
// Create Delivery Note
// =============================================================================

export class CreateDeliveryLineDto {
  @IsString()
  @IsNotEmpty()
  salesOrderLineId!: string;

  @IsString()
  @IsNotEmpty()
  productId!: string;

  /**
   * Cantidad a entregar. Decimal representado como string para evitar
   * pérdida de precisión en JSON (ej: "5.0000" o "5").
   */
  @IsNumberString({ no_symbols: false })
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  uom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /**
   * Números de serie a entregar. Obligatorio si el producto tiene
   * tracking = SERIAL. El count debe coincidir con quantity.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreateDeliveryNoteDto {
  @IsString()
  @IsNotEmpty()
  salesOrderId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryLineDto)
  lines!: CreateDeliveryLineDto[];

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// =============================================================================
// Ship Delivery Note
// =============================================================================

export class ShipDeliveryNoteDto {
  @IsOptional()
  @IsDateString()
  shippedDate?: string;
}

// =============================================================================
// Cancel Delivery Note
// =============================================================================

export class CancelDeliveryNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// =============================================================================
// List query params
// =============================================================================

export enum DeliveryNoteStateFilter {
  DRAFT = 'DRAFT',
  VALIDATED = 'VALIDATED',
  SHIPPED = 'SHIPPED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export class ListDeliveryNotesQueryDto {
  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsEnum(DeliveryNoteStateFilter)
  state?: DeliveryNoteStateFilter;

  @IsOptional()
  @IsString()
  recipientId?: string;

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
// Response shapes
// =============================================================================

export interface DeliveryNoteLineResponse {
  id: string;
  salesOrderLineId: string;
  productId: string;
  lineNumber: number;
  description?: string;
  quantity: string;
  uom: string;
  unitPriceArs: string;
  stockMoveId?: string;
  serialNumbers: string[];
}

export interface DeliveryNoteResponse {
  id: string;
  deliveryNumber: number;
  salesOrderId: string;
  recipientId: string;
  recipientName: string;
  recipientCuit: string;
  recipientAddress?: string;
  state: DeliveryNoteState;
  scheduledDate?: Date;
  shippedDate?: Date;
  doneDate?: Date;
  carrierId?: string;
  trackingCode?: string;
  notes?: string;
  lockedAt?: Date;
  version: number;
  createdById: string;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
  lines: DeliveryNoteLineResponse[];
}
