import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsInt,
  Min,
  IsEmail,
  ArrayMinSize,
  IsNumberString,
} from 'class-validator';
import { Transform } from 'class-transformer';

const ENTITY_ROLES = ['CUSTOMER', 'SUPPLIER', 'CARRIER'] as const;
const IVA_CONDITIONS = ['RI', 'MONOTRIBUTO', 'EXENTO', 'CF', 'NO_RESPONSABLE'] as const;

export class CreateEntityDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ENTITY_ROLES, { each: true })
  roles!: Array<(typeof ENTITY_ROLES)[number]>;

  @IsString()
  @Length(1, 255)
  @Transform(({ value }) => String(value).trim())
  legalName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  tradeName?: string;

  @IsString()
  @Matches(/^\d{2}-?\d{8}-?\d$/, {
    message: 'taxId must be a valid CUIT (XX-XXXXXXXX-X or 11 digits)',
  })
  taxId!: string;

  @IsEnum(IVA_CONDITIONS)
  ivaCondition!: (typeof IVA_CONDITIONS)[number];

  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() zipCode?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'creditLimit must be a decimal string' })
  creditLimit?: string;

  @IsOptional() @IsInt() @Min(0) paymentTermDays?: number;
  @IsOptional() @IsString() notes?: string;
}

export class UpdateEntityContactDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
}

export class ListEntitiesQueryDto {
  @IsOptional() @IsEnum(ENTITY_ROLES) role?: (typeof ENTITY_ROLES)[number];
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) isActive?: boolean;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) take?: number;
}
