-- ============================================================
-- scripts/postgres-init.sql
-- Se ejecuta automáticamente en el primer inicio del contenedor
-- ============================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- búsqueda fuzzy en razón social
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- exclusion constraints en stock

-- Configuración de timezone
SET timezone = 'America/Argentina/Buenos_Aires';
ALTER DATABASE erp_prod SET timezone TO 'America/Argentina/Buenos_Aires';

-- Configuración de performance
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = '100';
ALTER SYSTEM SET random_page_cost = '1.1';

SELECT pg_reload_conf();
