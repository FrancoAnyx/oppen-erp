// ============================================================
// prisma/seed.ts — Seed inicial obligatorio
// Uso: pnpm ts-node prisma/seed.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

// ─── Configuración (leer de .env o usar defaults de desarrollo) ───────────────
const TENANT_CUIT = process.env.SEED_TENANT_CUIT ?? '20-00000000-0';
const TENANT_NAME = process.env.SEED_TENANT_NAME ?? 'EMPRESA DE PRUEBA S.R.L.';
const TENANT_IVA  = process.env.SEED_TENANT_IVA_CONDITION ?? 'RI';
const TENANT_POS  = parseInt(process.env.SEED_TENANT_POS_NUMBER ?? '1');
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@empresa.com';
const ADMIN_PASS  = process.env.SEED_ADMIN_PASSWORD ?? 'Admin2024!';
const TENANT_ID   = process.env.SEED_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // ─── 1. TENANT ────────────────────────────────────────────────────────────
  console.log('📦 Creando tenant...');
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      legalName: TENANT_NAME,
      cuit: TENANT_CUIT,
      ivaCondition: TENANT_IVA as any,
      posNumber: TENANT_POS,
    },
  });
  console.log(`   ✅ Tenant: ${tenant.legalName} (CUIT: ${tenant.cuit})\n`);

  // ─── 2. USUARIO ADMIN ────────────────────────────────────────────────────
  console.log('👤 Creando usuario admin...');
  const passwordHash = await bcrypt.hash(ADMIN_PASS, 12);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      tenantId: TENANT_ID,
      email: ADMIN_EMAIL,
      passwordHash,
      firstName: 'Admin',
      lastName: 'Sistema',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  console.log(`   ✅ Admin: ${admin.email} (role: ${admin.role})\n`);

  // ─── 3. ALÍCUOTAS DE IVA ─────────────────────────────────────────────────
  console.log('💰 Creando alícuotas IVA...');

  const ivaRates = [
    { code: 'IVA_21',      rate: 21.0, description: 'IVA 21%',      afipCode: 5 },
    { code: 'IVA_10_5',    rate: 10.5, description: 'IVA 10.5%',    afipCode: 4 },
    { code: 'IVA_27',      rate: 27.0, description: 'IVA 27%',      afipCode: 6 },
    { code: 'IVA_2_5',     rate: 2.5,  description: 'IVA 2.5%',     afipCode: 9 },
    { code: 'IVA_5',       rate: 5.0,  description: 'IVA 5%',       afipCode: 8 },
    { code: 'IVA_EXENTO',  rate: 0.0,  description: 'Exento',       afipCode: 2 },
    { code: 'IVA_NO_GRAV', rate: 0.0,  description: 'No Gravado',   afipCode: 1 },
  ];

  for (const iva of ivaRates) {
    await prisma.ivaRate.upsert({
      where: { code: iva.code },
      update: {},
      create: {
        tenantId: TENANT_ID,
        code: iva.code,
        rate: iva.rate,
        description: iva.description,
        afipCode: iva.afipCode,
        isActive: true,
      },
    });
    console.log(`   ✅ ${iva.description} (ARCA código: ${iva.afipCode})`);
  }
  console.log();

  // ─── 4. UNIDADES DE MEDIDA ────────────────────────────────────────────────
  console.log('📐 Creando unidades de medida...');
  const units = [
    { code: 'UN',  description: 'Unidad',    afipCode: 7 },
    { code: 'KG',  description: 'Kilogramo', afipCode: 1 },
    { code: 'LT',  description: 'Litro',     afipCode: 5 },
    { code: 'MT',  description: 'Metro',     afipCode: 2 },
    { code: 'BOX', description: 'Caja',      afipCode: 14 },
    { code: 'HS',  description: 'Hora',      afipCode: 36 },
    { code: 'MES', description: 'Mes',       afipCode: 98 },
    { code: 'SVC', description: 'Servicio',  afipCode: 99 },
  ];

  for (const unit of units) {
    await prisma.unitOfMeasure.upsert({
      where: { code: unit.code },
      update: {},
      create: {
        tenantId: TENANT_ID,
        code: unit.code,
        description: unit.description,
        afipCode: unit.afipCode,
        isActive: true,
      },
    });
    console.log(`   ✅ ${unit.description} (${unit.code})`);
  }
  console.log();

  // ─── 5. CATEGORÍAS DE PRODUCTOS ──────────────────────────────────────────
  console.log('🗂️  Creando categorías de productos...');
  const categories = [
    { code: 'HW',   name: 'Hardware',           requiresSerial: true  },
    { code: 'SW',   name: 'Software / Licencias', requiresSerial: false },
    { code: 'NET',  name: 'Networking',          requiresSerial: true  },
    { code: 'PER',  name: 'Periféricos',         requiresSerial: false },
    { code: 'SVC',  name: 'Servicios',           requiresSerial: false },
    { code: 'CONS', name: 'Consumibles',         requiresSerial: false },
    { code: 'IMP',  name: 'Impresión',           requiresSerial: false },
  ];

  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { code: cat.code },
      update: {},
      create: {
        tenantId: TENANT_ID,
        code: cat.code,
        name: cat.name,
        requiresSerialNumber: cat.requiresSerial,
      },
    });
    console.log(`   ✅ ${cat.name} (serializable: ${cat.requiresSerial})`);
  }
  console.log();

  // ─── 6. CONDICIONES DE PAGO ───────────────────────────────────────────────
  console.log('📅 Creando condiciones de pago...');
  const paymentTerms = [
    { code: 'CONTADO',   name: 'Contado',       days: 0  },
    { code: '15_DIAS',   name: '15 días',       days: 15 },
    { code: '30_DIAS',   name: '30 días',       days: 30 },
    { code: '60_DIAS',   name: '60 días',       days: 60 },
    { code: '90_DIAS',   name: '90 días',       days: 90 },
    { code: 'ANTICIPO',  name: 'Anticipo 100%', days: -1 },
  ];

  for (const pt of paymentTerms) {
    await prisma.paymentTerm.upsert({
      where: { code: pt.code },
      update: {},
      create: {
        tenantId: TENANT_ID,
        code: pt.code,
        name: pt.name,
        daysNet: pt.days,
        isActive: true,
      },
    });
    console.log(`   ✅ ${pt.name}`);
  }
  console.log();

  // ─── 7. CUENTAS CONTABLES BASE ────────────────────────────────────────────
  console.log('🏦 Creando cuentas contables base...');
  const accounts = [
    { code: '1.1.01', name: 'Caja Pesos',           type: 'ACTIVO'  },
    { code: '1.1.02', name: 'Banco Cuenta Corriente', type: 'ACTIVO' },
    { code: '1.1.03', name: 'Cuentas a Cobrar',      type: 'ACTIVO'  },
    { code: '1.2.01', name: 'Inventario de Mercadería', type: 'ACTIVO' },
    { code: '2.1.01', name: 'Cuentas a Pagar',       type: 'PASIVO'  },
    { code: '2.1.02', name: 'IVA Débito Fiscal',     type: 'PASIVO'  },
    { code: '1.1.04', name: 'IVA Crédito Fiscal',    type: 'ACTIVO'  },
    { code: '4.1.01', name: 'Ventas de Mercadería',  type: 'INGRESO' },
    { code: '5.1.01', name: 'Costo de Ventas',       type: 'EGRESO'  },
    { code: '5.2.01', name: 'Gastos Generales',      type: 'EGRESO'  },
  ];

  for (const acc of accounts) {
    await prisma.accountChart.upsert({
      where: { code: acc.code },
      update: {},
      create: {
        tenantId: TENANT_ID,
        code: acc.code,
        name: acc.name,
        type: acc.type as any,
        isActive: true,
      },
    });
    console.log(`   ✅ [${acc.code}] ${acc.name}`);
  }
  console.log();

  // ─── RESUMEN ─────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('✅ SEED COMPLETADO EXITOSAMENTE');
  console.log('═══════════════════════════════════════════════');
  console.log(`\n🔐 Credenciales de acceso inicial:`);
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASS}`);
  console.log(`\n⚠️  IMPORTANTE: Cambiar la contraseña en el primer login`);
  console.log(`\n📋 Próximos pasos:`);
  console.log(`   1. Completar .env.production con los datos de ARCA`);
  console.log(`   2. Copiar certificados ARCA a ./secrets/`);
  console.log(`   3. Probar facturación en HOMOLOGACIÓN primero`);
  console.log(`   4. Activar FEATURE_ARCA_LIVE=true cuando todo esté validado\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
