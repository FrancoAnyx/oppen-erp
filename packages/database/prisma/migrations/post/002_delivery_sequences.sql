-- =============================================================================
-- packages/database/prisma/migrations/post/002_delivery_sequences.sql
-- Ejecutar con:
--   docker exec -i erp_postgres psql -U erp -d erp_dev \
--     < packages/database/prisma/migrations/post/002_delivery_sequences.sql
-- =============================================================================

-- Secuencia para numeración de remitos (misma estrategia que sales_order_number_seq)
CREATE SEQUENCE IF NOT EXISTS sales.delivery_note_number_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- Comentario en la tabla para documentación
COMMENT ON TABLE sales.delivery_notes IS
  'Remitos de entrega. Vinculados 1:N a sales_orders. '
  'Inmutables desde estado SHIPPED. Habilitan facturación en módulo fiscal.';

COMMENT ON TABLE sales.delivery_note_lines IS
  'Líneas del remito. Referencian sales_order_lines para control de parciales.';

-- Índice compuesto para consulta "¿cuánto fue entregado de la línea X de OV?"
-- Usado por DeliveryService.getPendingDeliveryQty
CREATE INDEX IF NOT EXISTS idx_dn_lines_so_line
  ON sales.delivery_note_lines (tenant_id, sales_order_line_id)
  WHERE delivery_note_id IN (
    SELECT id FROM sales.delivery_notes
    WHERE state NOT IN ('CANCELLED')
  );
-- Nota: el índice parcial filtra canceladas para no contabilizarlas.
-- En Postgres, índices parciales con subquery no están soportados directamente,
-- así que el filtro real se aplica en la query de la app. El índice es completo:

DROP INDEX IF EXISTS idx_dn_lines_so_line;
CREATE INDEX IF NOT EXISTS idx_dn_lines_so_line
  ON sales.delivery_note_lines (tenant_id, sales_order_line_id);
