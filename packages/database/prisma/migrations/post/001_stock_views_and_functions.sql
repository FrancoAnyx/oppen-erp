-- =============================================================================
-- 001_stock_views_and_functions.sql
-- Ejecutar después de prisma migrate deploy
-- docker exec -i oppen_postgres psql -U erp -d erp_dev < 001_stock_views_and_functions.sql
-- =============================================================================

CREATE OR REPLACE VIEW inventory.v_stock_quantities AS
SELECT
  sm.tenant_id, sm.product_id,
  COALESCE(SUM(CASE
    WHEN sm.state = 'DONE' AND l_dest.location_type = 'INTERNAL' THEN sm.quantity
    WHEN sm.state = 'DONE' AND l_src.location_type  = 'INTERNAL' THEN -sm.quantity
    ELSE 0 END), 0) AS physical,
  COALESCE(SUM(CASE
    WHEN sm.state IN ('CONFIRMED','ASSIGNED')
     AND l_src.location_type  = 'INTERNAL'
     AND l_dest.location_type = 'CUSTOMER' THEN sm.quantity
    ELSE 0 END), 0) AS committed,
  COALESCE(SUM(CASE
    WHEN sm.state IN ('CONFIRMED','ASSIGNED')
     AND l_src.location_type  = 'SUPPLIER'
     AND l_dest.location_type = 'INTERNAL' THEN sm.quantity
    ELSE 0 END), 0) AS incoming,
  COALESCE(SUM(CASE
    WHEN sm.state IN ('CONFIRMED','DONE') AND l_dest.location_type = 'RMA' THEN sm.quantity
    WHEN sm.state IN ('CONFIRMED','DONE') AND l_src.location_type  = 'RMA' THEN -sm.quantity
    ELSE 0 END), 0) AS rma
FROM inventory.stock_moves sm
JOIN inventory.locations l_src  ON l_src.id  = sm.source_location_id
JOIN inventory.locations l_dest ON l_dest.id = sm.dest_location_id
WHERE sm.state != 'CANCELLED'
GROUP BY sm.tenant_id, sm.product_id;

CREATE OR REPLACE FUNCTION inventory.get_available(p_tenant_id TEXT, p_product_id TEXT)
RETURNS NUMERIC AS $$
  SELECT COALESCE(physical - committed, 0)
  FROM inventory.v_stock_quantities
  WHERE tenant_id = p_tenant_id AND product_id = p_product_id;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION inventory.has_stock(p_tenant_id TEXT, p_product_id TEXT, p_qty NUMERIC)
RETURNS BOOLEAN AS $$
  SELECT inventory.get_available(p_tenant_id, p_product_id) >= p_qty;
$$ LANGUAGE SQL STABLE;
