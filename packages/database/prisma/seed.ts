import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const hash = (p: string) => createHash('sha256').update(`seed$${p}`).digest('hex');

async function main() {
  console.log('🌱 Seeding öppen ERP...');

  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      legalName: process.env['SEED_TENANT_NAME'] ?? 'DEMO EMPRESA S.R.L.',
      cuit: (process.env['SEED_TENANT_CUIT'] ?? '20-12345678-9').replace(/[-]/g, ''),
      ivaCondition: process.env['SEED_TENANT_IVA_CONDITION'] ?? 'RI',
      posNumber: Number(process.env['SEED_TENANT_POS_NUMBER'] ?? '1'),
    },
  });
  console.log(`  ✓ Tenant: ${tenant.legalName}`);

  const adminEmail = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@demo.local';
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: DEFAULT_TENANT_ID, email: adminEmail } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID, email: adminEmail,
      passwordHash: hash(process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin1234!'),
      fullName: 'Admin Demo', role: 'ADMIN',
    },
  });
  console.log(`  ✓ Admin: ${admin.email}`);

  const locs = [
    { code: 'WH-MAIN',      name: 'Depósito Principal',    locationType: 'INTERNAL'       as const },
    { code: 'VIRTUAL-CUST', name: 'Clientes (virtual)',    locationType: 'CUSTOMER'       as const },
    { code: 'VIRTUAL-SUPP', name: 'Proveedores (virtual)', locationType: 'SUPPLIER'       as const },
    { code: 'VIRTUAL-TRAN', name: 'Tránsito',              locationType: 'TRANSIT'        as const },
    { code: 'VIRTUAL-LOSS', name: 'Pérdida inventario',    locationType: 'INVENTORY_LOSS' as const },
    { code: 'VIRTUAL-RMA',  name: 'RMA / Devoluciones',   locationType: 'RMA'            as const },
  ];
  for (const l of locs) {
    await prisma.location.upsert({
      where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: l.code } },
      update: {}, create: { tenantId: DEFAULT_TENANT_ID, ...l },
    });
  }
  console.log(`  ✓ ${locs.length} locations`);

  const cat = await prisma.productCategory.upsert({
    where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name: 'Servidores' } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, name: 'Servidores', requiresSerial: true, costMethod: 'AVG' },
  });

  await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: DEFAULT_TENANT_ID, sku: 'DEMO-SRV-001' } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, categoryId: cat.id, sku: 'DEMO-SRV-001',
      name: 'Servidor Demo HP DL380', trackingType: 'SERIAL', costMethod: 'AVG',
      listPriceArs: 5000000, uom: 'UN' },
  });
  console.log('  ✓ Producto demo');

  await prisma.entity.upsert({
    where: { tenantId_taxId: { tenantId: DEFAULT_TENANT_ID, taxId: '30123456789' } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, entityType: ['CUSTOMER'],
      legalName: 'CLIENTE DEMO S.A.', taxId: '30123456789', ivaCondition: 'RI',
      email: 'compras@clientedemo.com', paymentTermDays: 30 },
  });

  await prisma.entity.upsert({
    where: { tenantId_taxId: { tenantId: DEFAULT_TENANT_ID, taxId: '30987654321' } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, entityType: ['SUPPLIER'],
      legalName: 'PROVEEDOR MAYORISTA S.A.', taxId: '30987654321', ivaCondition: 'RI',
      email: 'ventas@proveedor.com', paymentTermDays: 15 },
  });
  console.log('  ✓ Cliente y proveedor demo');

  await prisma.posNumber.upsert({
    where: { tenantId_number: { tenantId: DEFAULT_TENANT_ID, number: 1 } },
    update: {},
    create: { tenantId: DEFAULT_TENANT_ID, number: 1, description: 'Punto de Venta Principal' },
  });
  console.log('  ✓ PosNumber 1');

  console.log('\n✅ Seed completado');
  console.log(`   Login: ${adminEmail} / ${process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin1234!'}`);
  console.log('   ⚠️  Cambiar contraseña en producción!\n');
}

main().catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
      .finally(() => prisma.$disconnect());
