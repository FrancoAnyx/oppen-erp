# Setup en Windows (PowerShell)

> En PowerShell, `&&` no funciona. Ejecutar los comandos de a uno.

## Primer setup completo

```powershell
# 1. Instalar dependencias
pnpm install

# 2. Levantar PostgreSQL + Redis + Adminer
docker compose up -d

# 3. Generar cliente Prisma
pnpm db:generate

# 4. Aplicar migraciones
pnpm db:migrate

# 5. Correr vistas SQL de stock (OBLIGATORIO)
#    En PowerShell usar Get-Content con pipe:
Get-Content packages\database\prisma\migrations\post\001_stock_views_and_functions.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev

# 6. También correr las otras migrations post:
Get-Content packages\database\prisma\migrations\post\002_delivery_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
Get-Content packages\database\prisma\migrations\post\003_fiscal_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev

# 7. Seed inicial
pnpm db:seed

# 8. Arrancar API (puerto 3000)
pnpm dev

# 9. En otra terminal: arrancar Frontend (puerto 3001)
pnpm dev:web
```

## Login demo
- URL: http://localhost:3001
- Email: admin@demo.local
- Password: Admin1234!

## Comandos del día a día

```powershell
# Arrancar solo la API
pnpm dev

# Arrancar solo el frontend
pnpm dev:web

# Ver logs de Docker
docker compose logs -f

# Abrir Prisma Studio (UI para ver la DB)
pnpm db:studio

# Adminer (UI web para PostgreSQL)
# http://localhost:8080
# Server: postgres | User: erp | Pass: erp_dev_password | DB: erp_dev

# Reset completo de la DB (cuidado: borra todo)
pnpm db:reset
pnpm db:seed
```

## Troubleshooting

### `SyntaxError: does not provide an export named 'PrismaClient'`
```powershell
# El cliente de Prisma no fue generado. Ejecutar:
pnpm db:generate
```

### `relation inventory.v_stock_quantities does not exist`
```powershell
# Faltó correr la migration SQL. Ejecutar:
Get-Content packages\database\prisma\migrations\post\001_stock_views_and_functions.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
```

### `Cannot find module '@erp/shared'`
```powershell
# Los packages internos no fueron buildeados:
pnpm --filter @erp/shared build
pnpm --filter @erp/database build
```

### `dev:all` no funciona
```powershell
# Abrir dos terminales y ejecutar en cada una:
# Terminal 1:
pnpm dev
# Terminal 2:
pnpm dev:web
```
