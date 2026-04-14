import { Module } from '@nestjs/common';
import { CreateReceiptUseCase } from './application/use-cases/create-receipt.use-case';
import { RECEIPT_REPOSITORY } from './domain/repositories/accounting.repositories';
import { PrismaReceiptRepository } from './infrastructure/persistence/prisma-receipt.repository';
import { AccountingController } from './interfaces/http/accounting.controller';

@Module({
  controllers: [AccountingController],
  providers: [
    CreateReceiptUseCase,
    { provide: RECEIPT_REPOSITORY, useClass: PrismaReceiptRepository },
  ],
  exports: [CreateReceiptUseCase],
})
export class AccountingModule {}
