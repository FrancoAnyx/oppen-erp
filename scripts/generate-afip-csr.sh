#!/bin/bash
# ============================================================
# scripts/generate-afip-csr.sh — Generar CSR para ARCA/AFIP
# Uso: ./scripts/generate-afip-csr.sh "MI EMPRESA S.R.L." 20123456780
# ============================================================

set -euo pipefail

COMPANY="${1:?'Uso: ./generate-afip-csr.sh "EMPRESA S.R.L." 20123456780'}"
CUIT="${2:?'Uso: ./generate-afip-csr.sh "EMPRESA S.R.L." 20123456780'}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# Verificar openssl
command -v openssl &>/dev/null || fail "OpenSSL no está instalado (apt install openssl)"

mkdir -p secrets

echo ""
echo "Generando certificado para ARCA..."
echo "  Empresa: $COMPANY"
echo "  CUIT:    $CUIT"
echo ""

# Clave privada RSA 2048 bits
echo "1/2 Generando clave privada RSA 2048..."
openssl genrsa -out secrets/afip.key 2048 2>/dev/null
chmod 600 secrets/afip.key
ok "Clave privada: secrets/afip.key"

# CSR con los campos que ARCA requiere
echo "2/2 Generando CSR..."
openssl req -new \
  -key secrets/afip.key \
  -subj "/C=AR/O=${COMPANY}/CN=${COMPANY}/serialNumber=CUIT ${CUIT}" \
  -out secrets/afip.csr
ok "CSR generado: secrets/afip.csr"

# Mostrar contenido del CSR listo para copiar
echo ""
echo "════════════════════════════════════════════════════"
echo "  Contenido del CSR (pegar en el portal ARCA):"
echo "════════════════════════════════════════════════════"
cat secrets/afip.csr
echo "════════════════════════════════════════════════════"

echo ""
warn "La clave privada (afip.key) NUNCA debe salir del servidor"
echo ""
echo "📋 PRÓXIMOS PASOS:"
echo ""
echo "  1. Ingresar a: https://auth.afip.gob.ar"
echo "     (con CUIT ${CUIT} y Clave Fiscal nivel 3)"
echo ""
echo "  2. Menú: Mis Servicios → Administrador de Relaciones"
echo "     → Adherir Servicio → buscar 'WSFE' y 'WSFEX'"
echo "     → Confirmar para el representado"
echo ""
echo "  3. Menú: Mis Servicios → Administración de Certificados Digitales"
echo "     → Nuevo Certificado"
echo "     → Pegar el contenido del CSR de arriba"
echo "     → Descargar el .crt resultante"
echo ""
echo "  4. Guardar el .crt descargado como: secrets/afip.crt"
echo ""
echo "  5. Verificar:"
echo "     openssl verify -CAfile secrets/afip.crt secrets/afip.crt"
echo ""
echo "  6. Actualizar .env.production:"
echo "     AFIP_CUIT=${CUIT}"
echo "     AFIP_CERT_PATH=/run/secrets/afip.crt"
echo "     AFIP_KEY_PATH=/run/secrets/afip.key"
echo "     AFIP_PRODUCTION=false  ← primero probar en homologación"
echo ""
warn "El trámite puede tardar 1-3 días hábiles"
