-- =============================================================================
-- packages/database/prisma/migrations/post/003_fiscal_sequences.sql
-- =============================================================================

-- Tabla de secuencias locales para modo CAEA (contingencia).
-- En modo normal (CAE online) el número lo asigna ARCA en la respuesta.
-- En contingencia, nosotros pre-asignamos y luego informamos a ARCA.
CREATE TABLE IF NOT EXISTS fiscal.invoice_sequences (
  tenant_id   TEXT    NOT NULL,
  pos_number  INT     NOT NULL,
  doc_type    INT     NOT NULL,
  last_number BIGINT  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pos_number, doc_type)
);

-- Función para obtener el próximo número de comprobante (atómica)
CREATE OR REPLACE FUNCTION fiscal.next_invoice_number(
  p_tenant_id  TEXT,
  p_pos        INT,
  p_doc_type   INT
) RETURNS BIGINT AS $$
DECLARE
  v_next BIGINT;
BEGIN
  INSERT INTO fiscal.invoice_sequences (tenant_id, pos_number, doc_type, last_number)
  VALUES (p_tenant_id, p_pos, p_doc_type, 1)
  ON CONFLICT (tenant_id, pos_number, doc_type)
  DO UPDATE SET
    last_number = fiscal.invoice_sequences.last_number + 1,
    updated_at  = now()
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE fiscal.invoices IS
  'Comprobantes electrónicos emitidos ante ARCA. '
  'Inmutables desde estado APPROVED (CAE obtenido). '
  'Para corregir: emitir Nota de Crédito.';

COMMENT ON TABLE fiscal.arca_logs IS
  'Log de auditoría de cada llamada al WSFE de ARCA. '
  'Nunca eliminar. Clave para diagnóstico de rechazos.';
