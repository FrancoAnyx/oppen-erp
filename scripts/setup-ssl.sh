#!/bin/bash
# ============================================================
# scripts/setup-ssl.sh — Certificados SSL (Let's Encrypt)
# Uso: ./scripts/setup-ssl.sh tu-dominio.com admin@tu-empresa.com
# ============================================================

set -euo pipefail

DOMAIN="${1:?'Uso: ./setup-ssl.sh tu-dominio.com admin@empresa.com'}"
EMAIL="${2:?'Uso: ./setup-ssl.sh tu-dominio.com admin@empresa.com'}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Verificar que el dominio apunte a este servidor
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")
DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | tail -1 || echo "unknown")

echo "IP del servidor: $SERVER_IP"
echo "IP del dominio:  $DOMAIN_IP"

if [[ "$SERVER_IP" != "$DOMAIN_IP" ]]; then
  warn "El dominio $DOMAIN no apunta a este servidor ($SERVER_IP)"
  warn "Asegurate de configurar los DNS antes de continuar"
  read -p "¿Continuar de todas formas? (s/N): " confirm
  [[ "$confirm" != "s" ]] && exit 1
fi

# Instalar certbot si no está
if ! command -v certbot &>/dev/null; then
  echo "Instalando certbot..."
  apt-get update -qq
  apt-get install -y certbot
fi

# Crear directorio para certs
mkdir -p nginx/certs

# Detener nginx si está corriendo (para usar puerto 80)
docker compose -f docker-compose.prod.yml stop nginx 2>/dev/null || true

# Obtener certificado
certbot certonly \
  --standalone \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  -d "$DOMAIN" \
  -d "api.$DOMAIN"

# Copiar certificados al directorio de nginx
cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/certs/fullchain.pem
cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   nginx/certs/privkey.pem
chmod 600 nginx/certs/privkey.pem

ok "Certificados SSL instalados en nginx/certs/"

# Actualizar nginx.conf con el dominio real
sed -i "s/tu-dominio.com/$DOMAIN/g" nginx/nginx.conf
ok "nginx.conf actualizado con dominio: $DOMAIN"

# Configurar renovación automática
(crontab -l 2>/dev/null; echo "0 0 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $(pwd)/nginx/certs/fullchain.pem && cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $(pwd)/nginx/certs/privkey.pem && docker compose -f $(pwd)/docker-compose.prod.yml exec nginx nginx -s reload") | crontab -

ok "Renovación automática configurada (cron mensual)"
echo ""
echo "Dominio configurado: https://$DOMAIN"
echo "API configurada:     https://api.$DOMAIN"


# ============================================================
# scripts/generate-afip-csr.sh — Generar CSR para ARCA
# Uso: ./scripts/generate-afip-csr.sh "MI EMPRESA S.R.L." 20123456780
# ============================================================

cat > scripts/generate-afip-csr.sh << 'AFIP_SCRIPT'
#!/bin/bash
set -euo pipefail

COMPANY="${1:?'Uso: ./generate-afip-csr.sh "EMPRESA S.R.L." 20123456780'}"
CUIT="${2:?'Uso: ./generate-afip-csr.sh "EMPRESA S.R.L." 20123456780'}"

mkdir -p secrets

echo "Generando clave privada RSA 2048..."
openssl genrsa -out secrets/afip.key 2048
chmod 600 secrets/afip.key

echo "Generando CSR..."
openssl req -new \
  -key secrets/afip.key \
  -subj "/C=AR/O=${COMPANY}/CN=${COMPANY}/serialNumber=CUIT ${CUIT}" \
  -out secrets/afip.csr

echo ""
echo "✅ Archivos generados:"
echo "   secrets/afip.key  → Clave privada (NO compartir NUNCA)"
echo "   secrets/afip.csr  → Subir al portal ARCA"
echo ""
echo "📋 Próximos pasos:"
echo "   1. Ingresá a https://auth.afip.gob.ar"
echo "   2. Servicios → Administración de Certificados Digitales"
echo "   3. Nuevo certificado → pegar contenido de secrets/afip.csr"
echo "   4. Descargar el .crt resultante como secrets/afip.crt"
echo "   5. Solicitar acceso al servicio WSFE/WSFEX"
AFIP_SCRIPT

chmod +x scripts/generate-afip-csr.sh
ok "Script generate-afip-csr.sh creado"
