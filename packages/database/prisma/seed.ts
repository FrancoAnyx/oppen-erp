// seed.ts — CJS-compatible (no "type":"module" en package.json)
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const seedHash = (plain: string) =>
  createHash('sha256').update(`seed$${plain}`).digest('hex');

async function main() {
  console.log('\n🌱 Seeding öppen ERP...\n');

  // ── Tenant ──────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      legalName: process.env['SEED_TENANT_NAME'] ?? 'DEMO EMPRESA S.R.L.',
      cuit: (process.env['SEED_TENANT_CUIT'] ?? '20-12345678-9').replace(/-/g, ''),
      ivaCondition: process.env['SEED_TENANT_IVA_CONDITION'] ?? 'RI',
      posNumber: Number(process.env['SEED_TENANT_POS_NUMBER'] ?? '1'),
    },
  });
  console.log(`  ✓ Tenant: ${tenant.legalName}`);

  // ── Admin user ───────────────────────────────────────────────────
  const adminEmail    = process.env['SEED_ADMIN_EMAIL']    ?? 'admin@demo.local';
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin1234!';

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: DEFAULT_TENANT_ID, email: adminEmail } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      email: adminEmail,
      passwordHash: seedHash(adminPassword),
      fullName: 'Admin Demo',
      role: 'ADMIN',
    },
  });
  console.log(`  ✓ Admin: ${admin.email}`);

  // ── Locations ────────────────────────────────────────────────────
  const locations = [
    { code: 'WH-MAIN',      name: 'Depósito Principal',    locationType: 'INTERNAL'       as const },
    { code: 'VIRTUAL-CUST', name: 'Clientes (virtual)',    locationType: 'CUSTOMER'       as const },
    { code: 'VIRTUAL-SUPP', name: 'Proveedores (virtual)', locationType: 'SUPPLIER'       as const },
    { code: 'VIRTUAL-TRAN', name: 'Tránsito',              locationType: 'TRANSIT'        as const },
    { code: 'VIRTUAL-LOSS', name: 'Pérdida inventario',    locationType: 'INVENTORY_LOSS' as const },
    { code: 'VIRTUAL-RMA',  name: 'RMA / Devoluciones',   locationType: 'RMA'            as const },
  ];
  for (const loc of locations) {
    await prisma.location.upsert({
      where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: loc.code } },
      update: {},
      create: { tenantId: DEFAULT_TENANT_ID, ...loc },
    });
  }
  console.log(`  ✓ ${locations.length} locations`);

  // ── Categoría y producto demo ────────────────────────────────────
  const cat = await prisma.productCategory.upsert({
    where: { tenantId_name: { tenantId: DEFAULT_TENANT_ID, name: 'Servidores' } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      name: 'Servidores',
      requiresSerial: true,
      costMethod: 'AVG',
    },
  });

  await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: DEFAULT_TENANT_ID, sku: 'DEMO-SRV-001' } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      categoryId: cat.id,
      sku: 'DEMO-SRV-001',
      name: 'Servidor Demo HP DL380',
      trackingType: 'SERIAL',
      costMethod: 'AVG',
      listPriceArs: 5000000,
      uom: 'UN',
    },
  });
  console.log('  ✓ Producto demo: DEMO-SRV-001');

  // ── Entidades demo ───────────────────────────────────────────────
  await prisma.entity.upsert({
    where: { tenantId_taxId: { tenantId: DEFAULT_TENANT_ID, taxId: '30123456789' } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      entityType: ['CUSTOMER'],
      legalName: 'CLIENTE DEMO S.A.',
      taxId: '30123456789',
      ivaCondition: 'RI',
      email: 'compras@clientedemo.com',
      paymentTermDays: 30,
    },
  });

  await prisma.entity.upsert({
    where: { tenantId_taxId: { tenantId: DEFAULT_TENANT_ID, taxId: '30987654321' } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      entityType: ['SUPPLIER'],
      legalName: 'PROVEEDOR MAYORISTA S.A.',
      taxId: '30987654321',
      ivaCondition: 'RI',
      email: 'ventas@proveedor.com',
      paymentTermDays: 15,
    },
  });
  console.log('  ✓ Cliente y proveedor demo');

  // ── Punto de venta ───────────────────────────────────────────────
  await prisma.posNumber.upsert({
    where: { tenantId_number: { tenantId: DEFAULT_TENANT_ID, number: 1 } },
    update: {},
    create: {
      tenantId: DEFAULT_TENANT_ID,
      number: 1,
      description: 'Punto de Venta Principal',
    },
  });
  console.log('  ✓ PosNumber 1');

  // ── Cuenta bancaria demo ─────────────────────────────────────────
  const bankId = `bank-${DEFAULT_TENANT_ID.slice(-8)}`;
  await prisma.bankAccount.upsert({
    where: { id: bankId },
    update: {},
    create: {
      id: bankId,
      tenantId: DEFAULT_TENANT_ID,
      name: 'Cuenta Corriente Banco Nación',
      bankName: 'Banco Nación Argentina',
      currency: 'ARS',
      balance: 0,
    },
  });
  console.log('  ✓ Cuenta bancaria demo');

  console.log('\n✅ Seed completado exitosamente');
  console.log(`\n   🔑 Login: ${adminEmail}`);
  console.log(`   🔑 Pass:  ${adminPassword}`);
  console.log('   ⚠️  Cambiar contraseña antes de ir a producción!\n');
}

main()
  .catch((e) => { console.error('\n❌ Seed falló:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
