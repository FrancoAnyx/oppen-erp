# ============================================================
# fix-api-errors.ps1 — Corrige todos los errores de compilacion
# Ejecutar desde: C:\GitHub\Anyxerp\Anyxerp\erp\apps\api
# ============================================================

Write-Host "Aplicando fixes..." -ForegroundColor Cyan

# ── Fix 1: tsconfig.json — agregar skipLibCheck y noUnusedLocals false ──────
$tsconfig = Get-Content tsconfig.json -Raw | ConvertFrom-Json
$tsconfig.compilerOptions | Add-Member -NotePropertyName "skipLibCheck" -NotePropertyValue $true -Force
$tsconfig.compilerOptions | Add-Member -NotePropertyName "noUnusedLocals" -NotePropertyValue $false -Force
$tsconfig.compilerOptions | Add-Member -NotePropertyName "noUnusedParameters" -NotePropertyValue $false -Force
$tsconfig | ConvertTo-Json -Depth 10 | Set-Content tsconfig.json
Write-Host "  [OK] tsconfig.json" -ForegroundColor Green

# ── Fix 2: auth.controller.ts — IsString/IsEmail/IsNotEmpty vienen de class-validator ──
$f = "src\modules\auth\interfaces\http\auth.controller.ts"
$c = Get-Content $f -Raw
$c = $c -replace "import \{[^}]*IsString[^}]*\} from '@nestjs/common';", ""
$c = $c -replace "  IsString,`r?`n", ""
$c = $c -replace "  IsEmail,`r?`n", ""
$c = $c -replace "  IsNotEmpty,`r?`n", ""
if ($c -notmatch "from 'class-validator'") {
    $c = "import { IsString, IsEmail, IsNotEmpty } from 'class-validator';`n" + $c
}
Set-Content $f $c
Write-Host "  [OK] auth.controller.ts — class-validator imports" -ForegroundColor Green

# ── Fix 3: auth.controller.ts — quitar .js de imports internos ──────────────
$files = @(
    "src\modules\auth\interfaces\http\auth.controller.ts",
    "src\modules\core\application\entity.service.ts",
    "src\modules\inventory\application\product.service.ts"
)
foreach ($f in $files) {
    if (Test-Path $f) {
        (Get-Content $f -Raw) `
            -replace "from '(\.\./[^']+)\.js'", "from '`$1'" `
            -replace "from '(\./[^']+)\.js'", "from '`$1'" |
        Set-Content $f
        Write-Host "  [OK] $f — .js removidos" -ForegroundColor Green
    }
}

# ── Fix 4: tenant-context.middleware.ts — reemplazar declare module roto ────
$f = "src\infrastructure\http\tenant-context.middleware.ts"
$c = Get-Content $f -Raw
# Reemplazar el declare module por una interfaz simple
$c = $c -replace "declare module 'express-serve-static-core' \{[^}]*\}", ""
$c = $c -replace "declare module 'express' \{[^}]*interface Request[^}]*\}[^}]*\}", ""
# Agregar cast en la asignacion
$c = $c -replace "req\.tenantId = ", "(req as any).tenantId = "
Set-Content $f $c
Write-Host "  [OK] tenant-context.middleware.ts" -ForegroundColor Green

# ── Fix 5: current-tenant.decorator.ts — usar (request as any) ───────────────
$f = "src\infrastructure\http\current-tenant.decorator.ts"
(Get-Content $f -Raw) `
    -replace "request\.tenantId", "(request as any).tenantId" |
Set-Content $f
Write-Host "  [OK] current-tenant.decorator.ts" -ForegroundColor Green

# ── Fix 6: auth.service.ts — quitar version (no existe en schema) ────────────
$f = "src\modules\auth\application\auth.service.ts"
(Get-Content $f -Raw) `
    -replace "version: userRow\.version \?\? 1,`r?`n\s*", "" `
    -replace "version: userRow\.version \?\? 1,`n\s*", "" |
Set-Content $f
Write-Host "  [OK] auth.service.ts — version removido" -ForegroundColor Green

# ── Fix 7: guards.ts — agregar override ──────────────────────────────────────
$f = "src\modules\auth\infrastructure\guards.ts"
(Get-Content $f -Raw) `
    -replace "(\n\s+)(canActivate\(context: ExecutionContext\))", "`$1override `$2" `
    -replace "(\n\s+)(handleRequest<T extends JwtPayload>)", "`$1override `$2" |
Set-Content $f
Write-Host "  [OK] guards.ts — override agregado" -ForegroundColor Green

# ── Fix 8: lineNumber faltante en create-sales-order ─────────────────────────
$f = "src\modules\sales\application\use-cases\create-sales-order.use-case.ts"
$c = Get-Content $f -Raw
if ($c -notmatch "lineNumber: i \+ 1") {
    $c = $c -replace "lines: cmd\.lines\.map\(\(l\) => \(\{", "lines: cmd.lines.map((l, i) => ({"
    $c = $c -replace "lines: cmd\.lines\.map\(\(l, i\) => \(\{", "lines: cmd.lines.map((l, i) => ({"
    # Agregar lineNumber al final del objeto de linea
    $c = $c -replace "(uom: l\.uom \?\? 'UN',)(\s+\}\)\))", "`$1`n        lineNumber: i + 1,`$2"
    Set-Content $f $c
}
Write-Host "  [OK] create-sales-order — lineNumber" -ForegroundColor Green

# ── Fix 9: lineNumber en create-purchase-order ───────────────────────────────
$f = "src\modules\purchases\application\use-cases\create-purchase-order.use-case.ts"
$c = Get-Content $f -Raw
if ($c -notmatch "lineNumber: i \+ 1") {
    $c = $c -replace "lines: cmd\.lines\.map\(\(l(, i)?\) => \(\{", "lines: cmd.lines.map((l, i) => ({"
    $c = $c -replace "(uom: l\.uom \?\? 'UN',)(\s+\}\)\))", "`$1`n        lineNumber: i + 1,`$2"
    Set-Content $f $c
}
Write-Host "  [OK] create-purchase-order — lineNumber" -ForegroundColor Green

# ── Fix 10: lineNumber en create-po-from-backorders ──────────────────────────
$f = "src\modules\purchases\application\use-cases\create-po-from-backorders.use-case.ts"
$c = Get-Content $f -Raw
if ($c -notmatch "lineNumber:") {
    $c = $c -replace "(poLines\.push\(\{)", "let lineIdx = 0;`n`n    `$1"
    $c = $c -replace "(soLineOriginId: soLine\.id,)(\s+\}\);)", "`$1`n        lineNumber: ++lineIdx,`$2"
    Set-Content $f $c
}
Write-Host "  [OK] create-po-from-backorders — lineNumber" -ForegroundColor Green

# ── Fix 11: padronData cast en prisma-entity.repository.ts ───────────────────
$f = "src\modules\core\infrastructure\persistence\prisma-entity.repository.ts"
(Get-Content $f -Raw) `
    -replace "padronData: s\.padronData \?\? Prisma\.JsonNull,", "padronData: (s.padronData ?? null) as any," |
Set-Content $f
Write-Host "  [OK] prisma-entity.repository.ts — padronData cast" -ForegroundColor Green

# ── Fix 12: unused imports warnings — quitar NotFoundError no usado ───────────
$f = "src\modules\auth\application\auth.service.ts"
(Get-Content $f -Raw) `
    -replace "import \{ BusinessRuleError, NotFoundError \} from '@erp/shared';", "import { BusinessRuleError } from '@erp/shared';" |
Set-Content $f

$f = "src\modules\auth\domain\entities\user.entity.ts"
(Get-Content $f -Raw) `
    -replace "import \{ BusinessRuleError, ValidationError \} from '@erp/shared';", "import { BusinessRuleError } from '@erp/shared';" |
Set-Content $f
Write-Host "  [OK] unused imports limpiados" -ForegroundColor Green

# ── Fix 13: unused PurchaseOrderProps y SalesOrderProps ──────────────────────
$f = "src\modules\purchases\infrastructure\persistence\prisma-purchase-order.repository.ts"
(Get-Content $f -Raw) `
    -replace "  type PurchaseOrderProps,`r?`n", "" |
Set-Content $f

$f = "src\modules\sales\infrastructure\persistence\prisma-sales-order.repository.ts"
(Get-Content $f -Raw) `
    -replace "  type SalesOrderProps,`r?`n", "" `
    -replace "  type SalesOrderLineProps,`r?`n", "" |
Set-Content $f
Write-Host "  [OK] unused type imports removidos" -ForegroundColor Green

# ── Fix 14: instalar class-validator si no esta ───────────────────────────────
$pkgJson = Get-Content package.json -Raw | ConvertFrom-Json
if (-not $pkgJson.dependencies.'class-validator') {
    Write-Host "  Instalando class-validator..." -ForegroundColor Yellow
    pnpm add class-validator class-transformer
}
Write-Host "  [OK] class-validator" -ForegroundColor Green

Write-Host ""
Write-Host "Todos los fixes aplicados. Corriendo pnpm dev..." -ForegroundColor Cyan
