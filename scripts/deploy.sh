#!/bin/bash
# ============================================================
# scripts/deploy.sh — Script de deploy completo
# Uso: ./scripts/deploy.sh [--first-run] [--skip-build]
# ============================================================

set -euo pipefail

FIRST_RUN=false
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --first-run)   FIRST_RUN=true ;;
    --skip-build)  SKIP_BUILD=true ;;
  esac
done

# ─── Colores ─────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC}  $1"; }
fail() { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $1"; exit 1; }

# ─── Verificaciones previas ───────────────────────────────────
log "Verificando prerrequisitos..."

command -v docker   &>/dev/null || fail "Docker no está instalado"
command -v docker compose  &>/dev/null || fail "Docker Compose no está instalado"

[[ -f ".env.production" ]] || fail ".env.production no encontrado. Copiá .env.production.example y completalo."

# Verificar variables críticas
source .env.production
[[ -z "${DB_PASSWORD:-}" ]]    && fail "DB_PASSWORD no está seteado en .env.production"
[[ -z "${REDIS_PASSWORD:-}" ]] && fail "REDIS_PASSWORD no está seteado en .env.production"
[[ -z "${JWT_SECRET:-}" ]]     && fail "JWT_SECRET no está seteado en .env.production"
[[ "${JWT_SECRET}" == "CAMBIAR_POR_SECRETO_JWT_64_CHARS_MINIMO_AQUI_RANDOM" ]] && fail "JWT_SECRET no fue cambiado del valor de ejemplo"

# Verificar certificados ARCA si está en modo producción
if [[ "${AFIP_PRODUCTION:-false}" == "true" ]]; then
  [[ -f "secrets/afip.crt" ]] || fail "secrets/afip.crt no encontrado. Tramitá el certificado ARCA."
  [[ -f "secrets/afip.key" ]] || fail "secrets/afip.key no encontrado."
  ok "Certificados ARCA encontrados"
else
  warn "AFIP_PRODUCTION=false — usando HOMOLOGACIÓN de ARCA"
fi

# Verificar certificados SSL
[[ -f "nginx/certs/fullchain.pem" ]] || warn "nginx/certs/fullchain.pem no encontrado — HTTPS no funcionará"
[[ -f "nginx/certs/privkey.pem" ]]   || warn "nginx/certs/privkey.pem no encontrado — HTTPS no funcionará"

ok "Prerrequisitos verificados"

# ─── Build ────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "false" ]]; then
  log "Construyendo imágenes Docker..."
  docker compose -f docker-compose.prod.yml build --no-cache
  ok "Imágenes construidas"
fi

# ─── Primer deploy ────────────────────────────────────────────
if [[ "$FIRST_RUN" == "true" ]]; then
  log "PRIMER DEPLOY — inicializando base de datos..."

  # Levantar solo la DB primero
  docker compose -f docker-compose.prod.yml up -d db redis
  log "Esperando que la DB esté lista..."
  sleep 15

  # Correr migraciones
  log "Ejecutando migraciones Prisma..."
  docker compose -f docker-compose.prod.yml run --rm api \
    sh -c "npx prisma migrate deploy"
  ok "Migraciones aplicadas"

  # Correr seed
  log "Ejecutando seed inicial..."
  docker compose -f docker-compose.prod.yml run --rm api \
    sh -c "npx ts-node prisma/seed.ts"
  ok "Seed completado"
fi

# ─── Deploy principal ─────────────────────────────────────────
log "Levantando todos los servicios..."
docker compose -f docker-compose.prod.yml up -d

# ─── Health checks ────────────────────────────────────────────
log "Esperando que los servicios estén listos..."
sleep 20

check_health() {
  local service=$1
  local url=$2
  if curl -sf "$url" > /dev/null 2>&1; then
    ok "$service: saludable"
  else
    warn "$service: no responde en $url (puede tardar más en iniciar)"
  fi
}

check_health "API"      "http://localhost:3000/api/v1/health"
check_health "Frontend" "http://localhost:3001"

# ─── Cron de backups ─────────────────────────────────────────
if [[ "$FIRST_RUN" == "true" ]]; then
  log "Configurando cron de backups diarios (3:00 AM)..."
  (crontab -l 2>/dev/null; echo "0 3 * * * cd $(pwd) && docker compose -f docker-compose.prod.yml run --rm backup >> /var/log/erp-backup.log 2>&1") | crontab -
  ok "Cron de backup configurado"
fi

# ─── Resumen ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 DEPLOY COMPLETADO${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
echo "  Frontend:  http://localhost:3001"
echo "  API:       http://localhost:3000/api/v1"
echo "  API Docs:  http://localhost:3000/api/v1/docs"
echo ""
echo "  Logs:      docker compose -f docker-compose.prod.yml logs -f"
echo "  Status:    docker compose -f docker-compose.prod.yml ps"
echo ""

if [[ "$FIRST_RUN" == "true" ]]; then
  echo -e "${YELLOW}  ⚠️  PRIMER LOGIN:${NC}"
  echo "  Email:    ${SEED_ADMIN_EMAIL:-admin@empresa.com}"
  echo "  Password: ${SEED_ADMIN_PASSWORD:-Admin2024!}"
  echo -e "${YELLOW}  → Cambiar contraseña inmediatamente${NC}"
  echo ""
fi
