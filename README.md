# ERP Reseller Tech B2B (Argentina)

SaaS ERP para pymes reseller de tecnología B2B, con CRM integrado, inventario
double-entry, facturación electrónica ARCA (WSFE/WSFEX) y contabilidad.

## Stack

- **Backend**: NestJS 10 + Prisma 5 + PostgreSQL 16
- **Frontend**: Next.js (pendiente — próximas fases)
- **Queue**: BullMQ sobre Redis (para facturación ARCA asíncrona)
- **Infra**: Docker Compose para dev; preparado para AWS/DigitalOcean

## Estructura del monorepo

```
erp/
├── apps/
│   ├── api/              NestJS HTTP API
│   └── worker/           Procesos BullMQ (placeholder hasta fase fiscal)
├── packages/
│   ├── database/         Prisma schema + cliente
│   ├── shared/           Value objects, errores de dominio, constantes
│   └── config/           tsconfig base, lint base
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Prerequisitos

- Node.js 22 LTS
- pnpm 9+
- Docker + Docker Compose

## Setup inicial

```bash
# 1. Instalar dependencias
pnpm install

# 2. Copiar envs
cp apps/api/.env.example apps/api/.env

# 3. Levantar servicios (Postgres + Redis + Adminer)
pnpm docker:up

# 4. Build de packages internos (shared, database)
pnpm --filter @erp/shared build
pnpm --filter @erp/database build

# 5. Generar cliente Prisma
pnpm db:generate

# 6. Aplicar migraciones
pnpm db:migrate

# 7. Correr la migración SQL manual (vistas y funciones de stock)
docker exec -i erp_postgres psql -U erp -d erp_dev \
  < packages/database/prisma/migrations/post/001_stock_views_and_functions.sql

# 8. Seed de datos
pnpm db:seed

# 9. Arrancar API en modo dev
pnpm dev
```

La API queda en `http://localhost:3000/api/v1`.
Adminer en `http://localhost:8080` (server: `postgres`, user/pass: `erp/erp_dev_password`).

## Endpoints disponibles (Fase MVP — Core + Inventory)

### Health

- `GET /healthz` — liveness probe
- `GET /health` — readiness con chequeo DB

### Entities (clientes/proveedores)

- `POST /api/v1/entities` — crear
- `GET /api/v1/entities` — listar con filtros `?role=CUSTOMER&search=xxx`
- `GET /api/v1/entities/:id`
- `PATCH /api/v1/entities/:id/contact` — requiere `version` en el body
- `DELETE /api/v1/entities/:id?version=N` — soft delete

### Products & Stock

- `POST /api/v1/products`
- `GET /api/v1/products` — incluye stock calculado (bulk, sin N+1)
- `GET /api/v1/products/:id`
- `PATCH /api/v1/products/:id/list-price`
- `POST /api/v1/products/stock/receive` — recepción directa
- `POST /api/v1/products/stock/reserve` — reserva atómica anti-oversell

## Ejemplos

### Crear un cliente

```bash
curl -X POST http://localhost:3000/api/v1/entities \
  -H 'Content-Type: application/json' \
  -d '{
    "roles": ["CUSTOMER"],
    "legalName": "Acme Corp S.A.",
    "taxId": "30-50001091-2",
    "ivaCondition": "RI",
    "email": "contacto@acme.com",
    "creditLimit": "500000.00",
    "paymentTermDays": 30
  }'
```

### Crear un producto

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H 'Content-Type: application/json' \
  -d '{
    "sku": "HP-ZBOOK-G10",
    "name": "HP ZBook Studio G10",
    "tracking": "SERIAL",
    "ivaRate": "21.00",
    "standardCostUsd": "2100.0000",
    "listPriceArs": "2800000.00"
  }'
```

### Recibir stock (después de crear producto)

```bash
curl -X POST http://localhost:3000/api/v1/products/stock/receive \
  -H 'Content-Type: application/json' \
  -d '{
    "productId": "<PRODUCT_ID>",
    "quantity": "5",
    "destLocationId": "<WAREHOUSE_ID>",
    "originDocId": "initial-stock-001",
    "unitCostUsd": "2100.00"
  }'
```

### Reservar stock

```bash
curl -X POST http://localhost:3000/api/v1/products/stock/reserve \
  -H 'Content-Type: application/json' \
  -d '{
    "productId": "<PRODUCT_ID>",
    "quantity": "2",
    "originDocId": "so-demo-001"
  }'
```

Si hay suficiente stock → `{ moveId: "..." }`.
Si no → HTTP 422 con `{ error: { code: "INSUFFICIENT_STOCK", context: { ... } } }`.

## Tests

```bash
# Unitarios (dominio + value objects)
pnpm --filter @erp/shared test
pnpm --filter @erp/api test

# E2E (requiere DB corriendo + seed)
pnpm test:e2e
```

Los e2e ejercitan el flujo completo de inventory (recibir → reservar → entregar)
y validan el escenario de concurrencia (dos reservas simultáneas por el último ítem).

## Módulos implementados

### ✅ Core
- `Tenant` (preparado para multi-tenant futuro)
- `User`
- `Entity` (clientes/proveedores/carriers con multi-rol)
- Validación de CUIT con dígito verificador oficial ARCA

### ✅ Inventory
- `Product` con tracking NONE/LOT/SERIAL
- `ProductCategory` con herencia y `requiresSerial`
- `Location` con 7 tipos (INTERNAL + 6 virtuales)
- `StockMove` con state machine: DRAFT → CONFIRMED → ASSIGNED → DONE → CANCELLED
- `SerialNumber` con tracking individual
- Cálculo de los 5 estados (Physical/Available/Committed/Incoming/RMA) vía vista SQL
- **`StockReservationService`** anti-oversell con:
  - Transacción SERIALIZABLE
  - Lectura bajo aislamiento
  - Retry automático con backoff exponencial + jitter en conflictos P2034

### 🔜 Próximas fases
- **Sales**: Lead → Quote → Sales Order (consume `InventoryModule` via public-api)
- **Purchases**: Purchase Order → Receipt (consume `StockReceiptService`)
- **Fiscal**: Invoice + worker ARCA WSFE con BullMQ, CAEA para contingencia
- **Treasury**: Recibos, órdenes de pago, conciliación bancaria
- **Accounting**: asientos automáticos por evento de dominio

## Convenciones importantes

1. **Nunca hacer imports profundos entre módulos**. Usar siempre `public-api.ts`:
   ```ts
   // ✅
   import { StockReservationService } from '../../inventory/public-api.js';
   // ❌
   import { StockReservationService } from '../../inventory/application/services/...';
   ```

2. **Errores de dominio en lugar de `throw new Error`**. Usar `@erp/shared`:
   ```ts
   throw new BusinessRuleError('MY_RULE', 'My message', { context });
   ```

3. **Money con `@erp/shared`**, nunca con `number`:
   ```ts
   const total = Money.of('1000.50', 'ARS').add(Money.of('200', 'ARS'));
   ```

4. **Optimistic locking en todo aggregate mutable**: pasar `version` en el body
   de los PATCH, el repositorio lo verifica en el WHERE y lanza `ConcurrencyError`.

5. **`tenantId` en todas las queries**. Hoy es hardcoded, pero el día que
   activemos multi-tenant solo cambia el middleware.

## Troubleshooting

- **"relation inventory.v_stock_quantities does not exist"**: faltó correr la
  migración SQL manual del paso 7. Correrla antes del seed.
- **"Seed not run: admin user not found"** en tests e2e: correr `pnpm db:seed`.
- **"Cannot find module '@erp/shared'"**: `pnpm -r build` para buildear los
  packages internos.
