# ============================================================
# setup.ps1 — Script de setup inicial para Windows PowerShell
# Ejecutar: .\setup.ps1
# ============================================================

Write-Host "🚀 öppen ERP — Setup inicial" -ForegroundColor Cyan
Write-Host ""

# 1. Instalar dependencias
Write-Host "📦 Instalando dependencias..." -ForegroundColor Yellow
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error en pnpm install" -ForegroundColor Red; exit 1 }

# 2. Levantar Docker
Write-Host ""
Write-Host "🐳 Levantando PostgreSQL + Redis..." -ForegroundColor Yellow
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error levantando Docker" -ForegroundColor Red; exit 1 }

Write-Host "   Esperando que la DB esté lista (10s)..."
Start-Sleep -Seconds 10

# 3. Buildear @erp/shared PRIMERO (otros packages dependen de él)
Write-Host ""
Write-Host "🔨 Buildeando @erp/shared..." -ForegroundColor Yellow
pnpm --filter @erp/shared build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error buildeando shared" -ForegroundColor Red; exit 1 }

# 4. Generar cliente Prisma
Write-Host ""
Write-Host "🗄️  Generando cliente Prisma..." -ForegroundColor Yellow
pnpm db:generate
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error generando Prisma client" -ForegroundColor Red; exit 1 }

# 5. Buildear @erp/database (después de generate)
Write-Host ""
Write-Host "🔨 Buildeando @erp/database..." -ForegroundColor Yellow
pnpm --filter @erp/database build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error buildeando database" -ForegroundColor Red; exit 1 }

# 6. Aplicar migraciones
Write-Host ""
Write-Host "📋 Aplicando migraciones..." -ForegroundColor Yellow
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error en migraciones" -ForegroundColor Red; exit 1 }

# 7. Migraciones SQL post (vistas de stock)
Write-Host ""
Write-Host "📊 Aplicando vistas SQL de stock..." -ForegroundColor Yellow
Get-Content packages\database\prisma\migrations\post\001_stock_views_and_functions.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
Get-Content packages\database\prisma\migrations\post\002_delivery_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev
Get-Content packages\database\prisma\migrations\post\003_fiscal_sequences.sql | docker exec -i oppen_postgres psql -U erp -d erp_dev

# 8. Seed
Write-Host ""
Write-Host "🌱 Cargando datos iniciales (seed)..." -ForegroundColor Yellow
pnpm db:seed
if ($LASTEXITCODE -ne 0) { Write-Host "❌ Error en seed" -ForegroundColor Red; exit 1 }

# Listo
Write-Host ""
Write-Host "✅ Setup completado!" -ForegroundColor Green
Write-Host ""
Write-Host "Para arrancar el sistema:" -ForegroundColor Cyan
Write-Host "  Terminal 1 (API):      pnpm dev" -ForegroundColor White
Write-Host "  Terminal 2 (Frontend): pnpm dev:web" -ForegroundColor White
Write-Host ""
Write-Host "  API:      http://localhost:3000/api/v1" -ForegroundColor White
Write-Host "  Frontend: http://localhost:3001" -ForegroundColor White
Write-Host "  Login:    admin@demo.local / Admin1234!" -ForegroundColor White
Write-Host ""
