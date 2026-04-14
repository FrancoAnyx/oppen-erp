
import {
  Controller, Post, Get, Patch,
  Body, Param, Query,
  HttpCode, HttpStatus, Inject,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { NotFoundError } from '@erp/shared';
import { CurrentTenant } from '../../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../../auth/domain/jwt-payload.interface';
import { EmitInvoiceUseCase } from '../../application/use-cases/emit-invoice.use-case';
import {
  INVOICE_REPOSITORY,
  IInvoiceRepository,
} from '../../domain/repositories/fiscal.repositories';

class EmitInvoiceDto {
  @IsString() @IsNotEmpty() salesOrderId!: string;
  @IsString() @IsNotEmpty() posNumberId!: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
}

class ListInvoicesQueryDto {
  @IsOptional() @IsString() salesOrderId?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

@ApiTags('fiscal')
@ApiBearerAuth('JWT')
@Controller('invoices')
export class FiscalController {
  constructor(
    private readonly emitUC: EmitInvoiceUseCase,
    @Inject(INVOICE_REPOSITORY)
    private readonly invoiceRepo: IInvoiceRepository,
  ) {}

  /**
   * POST /invoices
   * Crea la factura en DB y la encola al worker ARCA.
   * Retorna inmediatamente — el CAE se obtiene de forma asíncrona.
   * Consultar estado con GET /invoices/:id.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)   // 202 — encolado, no procesado aún
  @ApiOperation({ summary: 'Emitir factura electrónica (encola al worker ARCA)' })
  async emit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: EmitInvoiceDto,
  ) {
    return this.emitUC.execute({
      tenantId,
      salesOrderId: dto.salesOrderId,
      posNumberId: dto.posNumberId,
      createdById: user.sub,
      invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
    });
  }

  /** GET /invoices */
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query() q: ListInvoicesQueryDto,
  ) {
    return this.invoiceRepo.findMany({
      tenantId,
      salesOrderId: q.salesOrderId,
      state: q.state as any,
      skip: q.skip,
      take: q.take,
    });
  }

  /** GET /invoices/:id — polling de estado (frontend usa esto para saber si llegó el CAE) */
  @Get(':id')
  @ApiOperation({ summary: 'Estado de la factura — incluye CAE si está APPROVED' })
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const inv = await this.invoiceRepo.findById(tenantId, id);
    if (!inv) throw new NotFoundError('Invoice', id);
    const p = inv.toProps();
    return {
      id: p.id,
      state: p.state,
      docTypeCode: p.docTypeCode,
      docTypeDesc: p.docTypeDesc,
      posNumber: p.posNumber,
      docNumber: p.docNumber,
      invoiceDate: p.invoiceDate,
      recipientName: p.recipientName,
      recipientCuit: p.recipientCuit,
      totalArs: p.totalArs,
      ivaBreakdown: p.ivaBreakdown,
      cae: p.cae,
      caeExpiresAt: p.caeExpiresAt,
      isContingency: p.isContingency,
      arcaAttempts: p.arcaAttempts,
      lastArcaError: p.lastArcaError,
      approvedAt: p.approvedAt,
      pdfPath: p.pdfPath,
      lines: p.lines.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        unitPriceArs: l.unitPriceArs,
        ivaRate: l.ivaRate,
        totalArs: l.totalArs,
      })),
    };
  }

  /** GET /invoices/by-sales-order/:soId */
  @Get('by-sales-order/:soId')
  async findBySalesOrder(
    @CurrentTenant() tenantId: string,
    @Param('soId') soId: string,
  ) {
    return this.invoiceRepo.findBySalesOrder(tenantId, soId);
  }
}

