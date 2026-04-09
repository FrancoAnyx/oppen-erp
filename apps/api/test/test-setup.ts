import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';

/**
 * Helper para tests e2e: levanta la app completa (con DB real) y provee
 * utilities para limpiar datos entre tests.
 *
 * Requisitos:
 *   - Postgres levantado en DATABASE_URL (docker compose up)
 *   - Migraciones aplicadas (pnpm db:migrate)
 *   - Seed corrido (pnpm db:seed) — necesitamos tenant/locations default
 */
export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  moduleRef: TestingModule;
  tenantId: string;
  userId: string;
  mainWarehouseId: string;
  customerLocId: string;
}

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const prisma = moduleRef.get(PrismaService);

  // Buscamos el user admin y las locations creadas por el seed
  const admin = await prisma.user.findFirst({
    where: { tenantId: DEFAULT_TENANT_ID, email: 'admin@demo.local' },
  });
  if (!admin) {
    throw new Error('Seed not run: admin user not found. Run `pnpm db:seed`.');
  }

  const warehouse = await prisma.location.findFirst({
    where: { tenantId: DEFAULT_TENANT_ID, code: 'WH-MAIN' },
  });
  const customer = await prisma.location.findFirst({
    where: { tenantId: DEFAULT_TENANT_ID, locationType: 'CUSTOMER' },
  });
  if (!warehouse || !customer) {
    throw new Error('Seed not run: default locations not found.');
  }

  return {
    app,
    prisma,
    moduleRef,
    tenantId: DEFAULT_TENANT_ID,
    userId: admin.id,
    mainWarehouseId: warehouse.id,
    customerLocId: customer.id,
  };
}

/**
 * Limpia datos transaccionales entre tests, preservando el seed base
 * (tenant, user, locations, categoría demo, producto demo).
 *
 * Borramos en orden inverso a dependencias para no chocar con FKs.
 */
export async function cleanupTestData(ctx: TestContext): Promise<void> {
  // Purchases (before inventory — lines reference products)
  await ctx.prisma.purchaseOrderLine.deleteMany({ where: { tenantId: ctx.tenantId } });
  await ctx.prisma.purchaseOrder.deleteMany({ where: { tenantId: ctx.tenantId } });

  // Sales
  await ctx.prisma.salesOrderLine.deleteMany({ where: { tenantId: ctx.tenantId } });
  await ctx.prisma.salesOrder.deleteMany({ where: { tenantId: ctx.tenantId } });

  await ctx.prisma.stockMoveSerial.deleteMany();
  await ctx.prisma.stockMove.deleteMany();
  await ctx.prisma.serialNumber.deleteMany();

  // Borrar productos creados por tests, preservando los del seed
  await ctx.prisma.product.deleteMany({
    where: {
      tenantId: ctx.tenantId,
      sku: { startsWith: 'TEST-' },
    },
  });

  // Borrar entities creadas por tests
  await ctx.prisma.entity.deleteMany({
    where: {
      tenantId: ctx.tenantId,
    },
  });
}

export async function teardownTestContext(ctx: TestContext): Promise<void> {
  await ctx.prisma.$disconnect();
  await ctx.app.close();
}
