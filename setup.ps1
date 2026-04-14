# ============================================================
# setup.ps1 — Setup inicial para Windows PowerShell
# Si da error de permisos ejecutar primero:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# ============================================================

$ErrorActionPreference = "Stop"

function Write-Step { param($msg) Write-Host "`n>>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Fail { param($msg) Write-Host "`n ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  oppen ERP - Setup inicial" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ── Paso 1: Copiar .env files ─────────────────────────────────
Write-Step "Configurando variables de entorno..."

if (-not (Test-Path "apps\api\.env")) {
    Copy-Item "apps\api\.env.example" "apps\api\.env"
    Write-OK "apps/api/.env creado desde .env.example"
} else {
    Write-OK "apps/api/.env ya existe"
}

if (-not (Test-Path "packages\database\.env")) {
    Copy-Item "packages\database\.env.example" "packages\database\.env"
    Write-OK "packages/database/.env creado desde .env.example"
} else {
    Write-OK "packages/database/.env ya existe"
}

# ── Paso 2: Verificar Docker ──────────────────────────────────
Write-Step "Verificando Docker Desktop..."
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  Docker Desktop no esta corriendo." -ForegroundColor Yellow
        Write-Host "  Abri Docker Desktop y espera que el icono en la barra de tareas" -ForegroundColor Yellow
        Write-Host "  muestre 'Docker Desktop is running', luego ejecuta setup.ps1 de nuevo." -ForegroundColor Yellow
        exit 1
    }
    Write-OK "Docker esta corriendo"
} catch {
    Write-Host ""
    Write-Host "  Docker Desktop no esta corriendo o no esta instalado." -ForegroundColor Yellow
    Write-Host "  Descargalo desde: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    exit 1
}

# ── Paso 3: Levantar servicios ────────────────────────────────
Write-Step "Levantando PostgreSQL + Redis..."
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Fail "Error levantando Docker Compose" }
Write-OK "Servicios iniciados"

Write-Host "  Esperando que la DB este lista (15s)..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# ── Paso 4: Instalar dependencias ────────────────────────────
Write-Step "Instalando dependencias (pnpm install)..."
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Fail "Error en pnpm install" }
Write-OK "Dependencias instaladas"

# ── Paso 5: Build @erp/shared ────────────────────────────────
Write-Step "Buildeando @erp/shared (CRITICO)..."
pnpm --filter "@erp/shared" build
if ($LASTEXITCODE -ne 0) { Write-Fail "Error buildeando @erp/shared" }
Write-OK "@erp/shared buildeado"

# ── Paso 6: Generar cliente Prisma ────────────────────────────
Write-Step "Generando cliente Prisma..."
pnpm db:generate
if ($LASTEXITCODE -ne 0) { Write-Fail "Error generando Prisma client" }
Write-OK "Cliente Prisma generado"

# ── Paso 7: Build @erp/database ──────────────────────────────
Write-Step "Buildeando @erp/database..."
pnpm --filter "@erp/database" build
if ($LASTEXITCODE -ne 0) { Write-Fail "Error buildeando @erp/database" }
Write-OK "@erp/database buildeado"

# ── Paso 8: Aplicar migraciones ──────────────────────────────
Write-Step "Aplicando migraciones Prisma..."
Write-Host "  (Si pregunta el nombre, escribi 'init' y Enter)" -ForegroundColor Gray
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Write-Fail "Error en migraciones" }
Write-OK "Migraciones aplicadas"

# ── Paso 9: Migraciones SQL post ─────────────────────────────
Write-Step "Aplicando vistas y funciones SQL..."

$sqlFiles = @(
    "packages\database\prisma\migrations\post\001_stock_views_and_functions.sql",
    "packages\database\prisma\migrations\post\002_delivery_sequences.sql",
    "packages\database\prisma\migrations\post\003_fiscal_sequences.sql"
)

foreach ($sqlFile in $sqlFiles) {
    if (Test-Path $sqlFile) {
        $fileName = Split-Path $sqlFile -Leaf
        Write-Host "  Aplicando $fileName..." -ForegroundColor Gray
        Get-Content $sqlFile | docker exec -i oppen_postgres psql -U erp -d erp_dev
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  Advertencia: error en $fileName (puede que ya exista)" -ForegroundColor Yellow
        } else {
            Write-OK $fileName
        }
    } else {
        Write-Host "  Advertencia: no se encontro $sqlFile" -ForegroundColor Yellow
    }
}

# ── Paso 10: Seed ─────────────────────────────────────────────
Write-Step "Cargando datos iniciales (seed)..."
pnpm db:seed
if ($LASTEXITCODE -ne 0) { Write-Fail "Error en seed" }
Write-OK "Datos iniciales cargados"

# ── Listo ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Setup completado exitosamente!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Para arrancar el sistema abre DOS terminales:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Terminal 1 (API NestJS):" -ForegroundColor White
Write-Host "    pnpm dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Terminal 2 (Frontend Next.js):" -ForegroundColor White
Write-Host "    pnpm dev:web" -ForegroundColor Yellow
Write-Host ""
Write-Host "  API:      http://localhost:3000/api/v1/health" -ForegroundColor Gray
Write-Host "  Frontend: http://localhost:3001" -ForegroundColor Gray
Write-Host "  Adminer:  http://localhost:8080" -ForegroundColor Gray
Write-Host ""
Write-Host "  Login: admin@demo.local / Admin1234!" -ForegroundColor Green
Write-Host ""
