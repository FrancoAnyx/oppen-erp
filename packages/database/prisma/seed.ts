// ============================================================
// packages/database/prisma/seed.ts
// Compatible con schema.prisma batch3 (cuid, multiSchema)
// Uso: pnpm prisma db seed
// ============================================================

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TENANT_ID   = process.env.SEED_TENANT_ID       ?? 'tenant-erp-0000000001';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL      ?? 'admin@empresa.com';
const ADMIN_PASS  = process.env.SEED_ADMIN_PASSWORD   ?? 'Admin1234!';
const TENANT_NAME = process.env.SEED_TENANT_NAME      ?? 'MI EMPRESA S.R.L.';
const TENANT_CUIT = process.env.SEED_TENANT_CUIT      ?? '20-00000000-0';

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // ── 1. Tenant ──────────────────────────────────────────────
  console.log('📦 Creando tenant...');
  const tenant = await prisma.tenant.upsert({
    where:  { id: TENANT_ID },
    update: {},
    create: {
      id:           TENANT_ID,
      legalName:    TENANT_NAME,
      cuit:         TENANT_CUIT,
      ivaCondition: 'RI',
      isActive:     true,
    },
  });
  console.log(`   ✅ ${tenant.legalName} (CUIT: ${tenant.cuit})\n`);

  // ── 2. Usuario admin ───────────────────────────────────────
  console.log('👤 Creando usuario admin...');
  const hash = await bcrypt.hash(ADMIN_PASS, 12);
  const admin = await prisma.user.upsert({
    where:  { tenantId_email: { tenantId: TENANT_ID, email: ADMIN_EMAIL } },
    update: {},
    create: {
      tenantId:     TENANT_ID,
      email:        ADMIN_EMAIL,
      passwordHash: hash,
      fullName:     'Admin Sistema',
      role:         'ADMIN',
      isActive:     true,
    },
  });
  console.log(`   ✅ ${admin.email} (role: ${admin.role})\n`);

  // ── 3. Locations ───────────────────────────────────────────
  console.log('🏭 Creando ubicaciones de stock...');
  const locationDefs = [
    { code: 'WH-MAIN',    name: 'Depósito Principal',     locationType: 'INTERNAL'       },
    { code: 'WH-TRANSIT', name: 'En Tránsito',            locationType: 'TRANSIT'        },
    { code: 'CUST-OUT',   name: 'Clientes (salidas)',     locationType: 'CUSTOMER'       },
    { code: 'SUPP-IN',    name: 'Proveedores (entradas)', locationType: 'SUPPLIER'       },
    { code: 'WH-RMA',     name: 'RMA / Devoluciones',     locationType: 'RMA'            },
    { code: 'INV-LOSS',   name: 'Pérdidas / Ajustes',     locationType: 'INVENTORY_LOSS' },
  ];

  for (const loc of locationDefs) {
    const existing = await prisma.location.findUnique({
      where: { tenantId_code: { tenantId: TENANT_ID, code: loc.code } },
    });
    if (!existing) {
      await prisma.location.create({
        data: {
          tenantId:     TENANT_ID,
          code:         loc.code,
          name:         loc.name,
          locationType: loc.locationType as any,
          isActive:     true,
        },
      });
    }
    console.log(`   ✅ ${loc.name} (${loc.code})`);
  }
  console.log();

  // ── 4. Categorías de productos ─────────────────────────────
  console.log('🗂️  Creando categorías...');
  const categoryDefs = [
    { name: 'Notebooks',            requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Desktops',             requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Servidores',           requiresSerial: true,  defaultWarrantyDays: 730 },
    { name: 'Monitores',            requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Networking',           requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Almacenamiento',       requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Impresoras',           requiresSerial: true,  defaultWarrantyDays: 365 },
    { name: 'Periféricos',          requiresSerial: false, defaultWarrantyDays: 180 },
    { name: 'Software / Licencias', requiresSerial: false, defaultWarrantyDays: 0   },
    { name: 'Consumibles',          requiresSerial: false, defaultWarrantyDays: 0   },
    { name: 'Servicios',            requiresSerial: false, defaultWarrantyDays: 0   },
    { name: 'Accesorios',           requiresSerial: false, defaultWarrantyDays: 90  },
  ];

  const categoryMap: Record<string, string> = {};
  for (const cat of categoryDefs) {
    const existing = await prisma.productCategory.findFirst({
      where: { tenantId: TENANT_ID, name: cat.name, parentId: null },
    });
    const record = existing ?? await prisma.productCategory.create({
      data: {
        tenantId:            TENANT_ID,
        name:                cat.name,
        requiresSerial:      cat.requiresSerial,
        defaultWarrantyDays: cat.defaultWarrantyDays,
        parentId:            null,
        isActive:            true,
      },
    });
    categoryMap[cat.name] = record.id;
    console.log(`   ✅ ${cat.name}`);
  }
  console.log();

  // ── 5. Productos de ejemplo ────────────────────────────────
  console.log('📦 Creando productos de ejemplo...');
  const productDefs = [
    {
      sku:             'NB-LENOVO-V15-G4',
      name:            'Notebook Lenovo V15 G4 i5/8GB/512SSD',
      description:     'Intel Core i5-1235U, 8GB DDR4, SSD 512GB, 15.6" FHD',
      category:        'Notebooks',
      tracking:        'SERIAL',
      ivaRate:         21.00,
      standardCostUsd: 420.00,
      uom:             'UN',
    },
    {
      sku:             'NB-HP-240G9',
      name:            'Notebook HP 240 G9 i3/8GB/256SSD',
      description:     'Intel Core i3-1215U, 8GB DDR4, SSD 256GB, 14" HD',
      category:        'Notebooks',
      tracking:        'SERIAL',
      ivaRate:         21.00,
      standardCostUsd: 300.00,
      uom:             'UN',
    },
    {
      sku:             'SW-OFFICE-365-BIZ',
      name:            'Microsoft 365 Business Basic (anual)',
      description:     'Licencia anual por usuario, Teams, Exchange, SharePoint',
      category:        'Software / Licencias',
      tracking:        'NONE',
      ivaRate:         21.00,
      standardCostUsd: 60.00,
      uom:             'LIC',
    },
    {
      sku:             'SVC-SOPORTE-MES',
      name:            'Soporte Técnico Mensual',
      description:     'Soporte remoto y presencial, cobertura mensual',
      category:        'Servicios',
      tracking:        'NONE',
      ivaRate:         21.00,
      standardCostUsd: 0,
      uom:             'MES',
    },
    {
      sku:             'NET-TPLINK-SG108',
      name:            'Switch TP-Link TL-SG108 8 puertos Gigabit',
      description:     'Switch no administrable 8 puertos 10/100/1000 Mbps',
      category:        'Networking',
      tracking:        'SERIAL',
      ivaRate:         21.00,
      standardCostUsd: 35.00,
      uom:             'UN',
    },
  ];

  for (const p of productDefs) {
    const existing = await prisma.product.findUnique({
      where: { tenantId_sku: { tenantId: TENANT_ID, sku: p.sku } },
    });
    if (!existing) {
      await prisma.product.create({
        data: {
          tenantId:        TENANT_ID,
          sku:             p.sku,
          name:            p.name,
          description:     p.description,
          categoryId:      categoryMap[p.category] ?? null,
          tracking:        p.tracking as any,
          ivaRate:         p.ivaRate,
          standardCostUsd: p.standardCostUsd > 0 ? p.standardCostUsd : null,
          uom:             p.uom,
          isActive:        true,
        },
      });
    }
    console.log(`   ✅ [${p.sku}] ${p.name}`);
  }
  console.log();

  // ── 6. Clientes ────────────────────────────────────────────
  console.log('👥 Creando clientes de ejemplo...');
  const customerDefs = [
    {
      legalName:      'ACME TECNOLOGÍA S.A.',
      tradeName:      'ACME',
      taxId:          '30712345679',
      ivaCondition:   'RI',
      entityType:     ['CUSTOMER'],
      email:          'compras@acme.com.ar',
      phone:          '011-4555-1234',
      creditLimit:    500000,
      paymentTermDays:30,
    },
    {
      legalName:      'GONZALEZ MARIO ALBERTO',
      tradeName:      'Mario Gonzalez',
      taxId:          '20287654321',
      ivaCondition:   'MONOTRIBUTO',
      entityType:     ['CUSTOMER'],
      email:          'mario.gonzalez@gmail.com',
      phone:          '11-6789-0123',
      creditLimit:    50000,
      paymentTermDays:0,
    },
  ];

  for (const c of customerDefs) {
    const existing = await prisma.entity.findUnique({
      where: { tenantId_taxId: { tenantId: TENANT_ID, taxId: c.taxId } },
    });
    if (!existing) {
      await prisma.entity.create({
        data: {
          tenantId:        TENANT_ID,
          legalName:       c.legalName,
          tradeName:       c.tradeName,
          taxId:           c.taxId,
          ivaCondition:    c.ivaCondition,
          entityType:      c.entityType,
          email:           c.email,
          phone:           c.phone,
          creditLimit:     c.creditLimit,
          paymentTermDays: c.paymentTermDays,
          isActive:        true,
        },
      });
    }
    console.log(`   ✅ ${c.legalName}`);
  }
  console.log();

  // ── 7. Proveedor ───────────────────────────────────────────
  console.log('🏢 Creando proveedor de ejemplo...');
  const supplierExists = await prisma.entity.findUnique({
    where: { tenantId_taxId: { tenantId: TENANT_ID, taxId: '30596787104' } },
  });
  if (!supplierExists) {
    await prisma.entity.create({
      data: {
        tenantId:        TENANT_ID,
        legalName:       'DISTRIBUIDORA TECH S.R.L.',
        tradeName:       'DisTech',
        taxId:           '30596787104',
        ivaCondition:    'RI',
        entityType:      ['SUPPLIER'],
        email:           'ventas@distech.com.ar',
        phone:           '011-4777-9900',
        creditLimit:     0,
        paymentTermDays: 0,
        isActive:        true,
      },
    });
  }
  console.log('   ✅ DISTRIBUIDORA TECH S.R.L.\n');

  // ── Resumen ────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log('✅ SEED COMPLETADO EXITOSAMENTE');
  console.log('═══════════════════════════════════════════');
  console.log(`\n🔐 Credenciales:`);
  console.log(`   URL:      http://localhost:3001`);
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASS}`);
  console.log(`\n📦 Cargado: 1 tenant, 1 admin, 6 locations, 12 categorías, 5 productos, 3 entidades\n`);
}

main()
  .catch((e) => {
    console.error('\n❌ Error en seed:', e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
