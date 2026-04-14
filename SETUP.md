# Setup — öppen ERP en Windows (PowerShell)

## Opción A: Script automático (recomendado)

```powershell
# Ejecutar desde la raíz del repo
.\setup.ps1
```

El script hace todo en el orden correcto y te muestra el progreso.

---

## Opción B: Paso a paso manual

> ⚠️ En PowerShell `&&` no funciona. Ejecutar cada comando por separado.

### 1. Instalar dependencias
```powershell
pnpm install
```

### 2. Levantar Docker (PostgreSQL + Redis)
```powershell
docker compose up -d
```
Esperar ~10 segundos para que la DB esté lista.

### 3. Buildear `@erp/shared` — OBLIGATORIO antes de todo
```powershell
pnpm --filter @erp/shared build
```
> Este paso es crítico. Sin él, TypeScript no encuentra los tipos y muestra 271 errores.

### 4. Generar cliente Prisma
```powershell
pnpm db:generate
```

### 5. Buildear `@erp/database` (después del generate)
```powershell
pnpm --filter @erp/database build
```

### 6. Aplicar migraciones
```powershell
pnpm db:migrate
```
Cuando pregunte el nombre de la migración, escribir: `init` y Enter.

### 7. Vistas SQL de stock (sintaxis PowerShell)
```powershell
Get-Content packages\database\prisma\migrations\post\001_stock_views_and_functions.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
Get-Content packages\database\prisma\migrations\post\002_delivery_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
Get-Content packages\database\prisma\migrations\post\003_fiscal_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
```

### 8. Seed (datos iniciales)
```powershell
pnpm db:seed
```

### 9. Arrancar el sistema

**Terminal 1 — API:**
```powershell
pnpm dev
```

**Terminal 2 — Frontend:**
```powershell
pnpm dev:web
```

---

## URLs

| Servicio | URL |
|----------|-----|
| API | http://localhost:3000/api/v1 |
| Frontend | http://localhost:3001 |
| Adminer (DB UI) | http://localhost:8080 |
| Health check | http://localhost:3000/api/v1/health |

## Login demo
- **Email:** admin@demo.local
- **Password:** Admin1234!

---

## Troubleshooting

### `Cannot find module '@erp/shared'` (271 errores TypeScript)
```powershell
pnpm --filter @erp/shared build
pnpm --filter @erp/database build
```
Esto genera las carpetas `dist/` que TypeScript necesita.

### `SyntaxError: does not provide an export named 'PrismaClient'`
```powershell
pnpm db:generate
pnpm --filter @erp/database build
```

### `relation inventory.v_stock_quantities does not exist`
```powershell
Get-Content packages\database\prisma\migrations\post\001_stock_views_and_functions.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
```

### La DB no está lista al hacer migrate
```powershell
docker compose up -d
Start-Sleep -Seconds 15
pnpm db:migrate
```

### Ver logs de la DB
```powershell
docker compose logs -f postgres
```

### Reset completo (borra todos los datos)
```powershell
pnpm db:reset
pnpm db:seed
```
