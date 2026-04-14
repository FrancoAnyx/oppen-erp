
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SalesModule } from '../sales/sales.module';
import { EmitInvoiceUseCase, INVOICE_QUEUE } from './application/use-cases/emit-invoice.use-case';
import { InvoiceProcessor } from './worker/invoice.processor';
import { INVOICE_REPOSITORY } from './domain/repositories/fiscal.repositories';
import { PrismaInvoiceRepository } from './infrastructure/persistence/prisma-invoice.repository';
import { WsfeService, WSFE_SERVICE } from './infrastructure/arca/wsfe.service';
import { FiscalController } from './interfaces/http/fiscal.controller';

@Module({
  imports: [
    SalesModule,  // para marcar OV INVOICED via SALES_ORDER_REPOSITORY
    BullModule.registerQueue({ name: INVOICE_QUEUE }),
  ],
  controllers: [FiscalController],
  providers: [
    // Use cases
    EmitInvoiceUseCase,
    // Worker processor
    InvoiceProcessor,
    // Infrastructure
    { provide: INVOICE_REPOSITORY, useClass: PrismaInvoiceRepository },
    { provide: WSFE_SERVICE,       useClass: WsfeService },
  ],
  exports: [INVOICE_REPOSITORY],
})
export class FiscalModule {}
