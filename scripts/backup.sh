#!/bin/sh
# ============================================================
# scripts/backup.sh — Backup automático PostgreSQL
# Se ejecuta desde el contenedor de backup en docker-compose
# Para cron: ver scripts/setup-cron.sh
# ============================================================

set -e

BACKUP_DIR="/backups"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-erp_user}"
DB_NAME="${DB_NAME:-erp_prod}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/erp_${TIMESTAMP}.sql.gz"

echo "[$TIMESTAMP] Iniciando backup de ${DB_NAME}..."

# Crear directorio si no existe
mkdir -p "$BACKUP_DIR"

# Dump comprimido
pg_dump \
  -h "$DB_HOST" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[$TIMESTAMP] ✅ Backup completado: $BACKUP_FILE ($SIZE)"

# Limpiar backups viejos
find "$BACKUP_DIR" -name "erp_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
echo "[$TIMESTAMP] 🧹 Backups anteriores a ${RETENTION_DAYS} días eliminados"

# Verificar integridad del backup
gunzip -t "$BACKUP_FILE" 2>/dev/null && echo "[$TIMESTAMP] ✅ Integridad OK" || {
  echo "[$TIMESTAMP] ❌ ERROR: Backup corrupto"
  exit 1
}
