import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EntityService } from '../../application/entity.service';
import { CurrentTenant } from '../../../../infrastructure/http/current-tenant.decorator';
import {
  CreateEntityDto,
  UpdateEntityContactDto,
  ListEntitiesQueryDto,
} from './dto/entity.dto';
import type { Entity } from '../../domain/entities/entity';

/**
 * Presenter para la response HTTP. Nunca exponer el aggregate de dominio al
 * cliente — siempre un DTO plano y estable. El shape de la response es parte
 * del contrato público del API.
 */
function toResponse(entity: Entity) {
  const s = entity.toState();
  return {
    id: s.id,
    roles: s.roles,
    legalName: s.legalName,
    tradeName: s.tradeName,
    taxId: s.taxId,
    taxIdFormatted: entity.cuit.format(),
    ivaCondition: s.ivaCondition,
    email: s.email,
    phone: s.phone,
    address: s.address,
    city: s.city,
    province: s.province,
    zipCode: s.zipCode,
    creditLimit: s.creditLimit,
    paymentTermDays: s.paymentTermDays,
    isActive: s.isActive,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

@Controller('entities')
export class EntityController {
  constructor(private readonly service: EntityService) {}

  @Post()
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateEntityDto) {
    const entity = await this.service.create({ tenantId, ...dto });
    return toResponse(entity);
  }

  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListEntitiesQueryDto,
  ) {
    const result = await this.service.list({ tenantId, ...query });
    return {
      items: result.items.map(toResponse),
      total: result.total,
      skip: query.skip ?? 0,
      take: query.take ?? 50,
    };
  }

  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const entity = await this.service.findById(tenantId, id);
    return toResponse(entity);
  }

  @Patch(':id/contact')
  async updateContact(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEntityContactDto,
  ) {
    const { version, ...contact } = dto;
    const entity = await this.service.updateContact(tenantId, id, version, contact);
    return toResponse(entity);
  }

  @Delete(':id')
  @HttpCode(204)
  async deactivate(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('version') version: string,
  ) {
    await this.service.deactivate(tenantId, id, Number(version));
  }
}

