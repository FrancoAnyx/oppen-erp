import { Controller, Get, Post, Param, Body, UseGuards, Inject } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/infrastructure/guards';
import { CurrentTenant } from '../../../../infrastructure/http/current-tenant.decorator';
import { CreateReceiptUseCase } from '../../application/use-cases/create-receipt.use-case';
import { IReceiptRepository, RECEIPT_REPOSITORY } from '../../domain/repositories/accounting.repositories';

@UseGuards(JwtAuthGuard)
@Controller('accounting')
export class AccountingController {
  constructor(
    private readonly createReceipt: CreateReceiptUseCase,
    @Inject(RECEIPT_REPOSITORY) private readonly repo: IReceiptRepository,
  ) {}

  @Post('receipts')
  create(@Body() body: any, @CurrentTenant() tenantId: string) {
    return this.createReceipt.execute({ ...body, tenantId });
  }

  @Get('receipts')
  list(@CurrentTenant() tenantId: string) {
    return this.repo.findMany({ tenantId });
  }

  @Get('balance/:entityId')
  balance(@Param('entityId') entityId: string, @CurrentTenant() tenantId: string) {
    return this.repo.getEntityBalance(tenantId, entityId);
  }
}
