# öppen ERP

**ERP SaaS B2B para Resellers de Tecnología — Argentina**

Sistema de gestión empresarial que combina CRM moderno + ERP fiscal, cumpliendo con **ARCA (ex-AFIP)**.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | NestJS 10 + TypeScript strict |
| ORM | Prisma 5 + PostgreSQL 16 |
| Frontend | Next.js 14 + Tailwind CSS |
| Queue | BullMQ + Redis 7 |
| Auth | JWT + bcrypt (12 rounds) |
| Fiscal | ARCA WSFE/WSFEX SOAP |

## Módulos

| Módulo | Descripción |
|--------|-------------|
| **Auth** | JWT global guard, login, @Public opt-out |
| **Core** | Tenant, Users, Entities multi-rol, CUIT validación módulo 11 |
| **Inventory** | Double-entry stock moves, 5 estados, serialización S/N |
| **Sales** | OV DRAFT→INVOICED, reserva anti-overselling con SERIALIZABLE |
| **Purchases** | OC back-to-back, recepción parcial |
| **Delivery** | Remitos vinculados a OV |
| **Fiscal** | Facturas WSFE, CAE, modo contingencia CAEA, Padrón A4 |
| **Accounting** | Recibos COBRO/PAGO, saldo CC, cuentas bancarias |

## Setup local

```bash
# 1. Instalar dependencias
pnpm install

# 2. Variables de entorno
cp apps/api/.env.example apps/api/.env

# 3. Levantar servicios
docker compose up -d

# 4. Build packages
pnpm --filter @erp/shared build
pnpm --filter @erp/database build

# 5. Migraciones
pnpm db:generate
pnpm db:migrate

# 6. Vistas SQL de stock (OBLIGATORIO)
docker exec -i oppen_postgres psql -U erp -d erp_dev \
  < packages/database/prisma/migrations/post/001_stock_views_and_functions.sql

# 7. Seed
pnpm db:seed

# 8. Arrancar
pnpm dev:all
```

**API:** `http://localhost:3000/api/v1`  
**Frontend:** `http://localhost:3001`  
**Adminer:** `http://localhost:8080`  
**Login demo:** `admin@demo.local` / `Admin1234!`

## Tests

```bash
pnpm test        # unitarios
pnpm test:e2e    # e2e (requiere DB + seed)
```

## Convenciones

1. Cross-module: solo via `module/public-api.ts`
2. Errores: `BusinessRuleError / ValidationError / ConcurrencyError` de `@erp/shared`
3. Optimistic locking: campo `version` en todos los aggregates
4. Inmutabilidad fiscal: trigger DB + flag app bloquean edición post-CAE
5. Money: `decimal.js` — nunca `number` para montos
6. `tenantId` en todas las queries

Ver [`DEPLOY.md`](DEPLOY.md) para producción.
