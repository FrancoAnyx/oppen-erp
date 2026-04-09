-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "core";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "inventory";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "purchases";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sales";

-- CreateEnum
CREATE TYPE "core"."UserRole" AS ENUM ('ADMIN', 'MANAGER', 'USER', 'VIEWER');

-- CreateEnum
CREATE TYPE "inventory"."TrackingType" AS ENUM ('NONE', 'LOT', 'SERIAL');

-- CreateEnum
CREATE TYPE "inventory"."CostMethod" AS ENUM ('FIFO', 'AVG', 'STD');

-- CreateEnum
CREATE TYPE "inventory"."LocationType" AS ENUM ('INTERNAL', 'CUSTOMER', 'SUPPLIER', 'TRANSIT', 'INVENTORY_LOSS', 'PRODUCTION', 'RMA');

-- CreateEnum
CREATE TYPE "inventory"."MoveState" AS ENUM ('DRAFT', 'CONFIRMED', 'ASSIGNED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "inventory"."SerialStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'DELIVERED', 'RMA', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "sales"."SalesOrderState" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL', 'DELIVERED', 'INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "purchases"."PurchaseOrderState" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "core"."tenants" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "iva_condition" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "core"."UserRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."entities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT[],
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "tax_id" TEXT NOT NULL,
    "iva_condition" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "zip_code" TEXT,
    "padron_data" JSONB,
    "padron_synced_at" TIMESTAMP(3),
    "credit_limit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."product_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "requires_serial" BOOLEAN NOT NULL DEFAULT false,
    "default_warranty_days" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT,
    "tracking" "inventory"."TrackingType" NOT NULL DEFAULT 'NONE',
    "iva_rate" DECIMAL(5,2) NOT NULL DEFAULT 21.00,
    "internal_tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cost_method" "inventory"."CostMethod" NOT NULL DEFAULT 'FIFO',
    "standard_cost_usd" DECIMAL(18,4),
    "list_price_ars" DECIMAL(18,2),
    "weight_kg" DECIMAL(10,3),
    "uom" TEXT NOT NULL DEFAULT 'UN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."locations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location_type" "inventory"."LocationType" NOT NULL,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_moves" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'UN',
    "source_location_id" TEXT NOT NULL,
    "dest_location_id" TEXT NOT NULL,
    "state" "inventory"."MoveState" NOT NULL DEFAULT 'DRAFT',
    "origin_doc_type" TEXT NOT NULL,
    "origin_doc_id" TEXT NOT NULL,
    "origin_line_id" TEXT,
    "unit_cost" DECIMAL(18,4),
    "unit_cost_usd" DECIMAL(18,4),
    "fx_rate" DECIMAL(18,6),
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "done_date" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."serial_numbers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "current_location_id" TEXT,
    "status" "inventory"."SerialStatus" NOT NULL DEFAULT 'IN_STOCK',
    "warranty_start" TIMESTAMP(3),
    "warranty_end" TIMESTAMP(3),
    "purchase_move_id" TEXT,
    "metadata" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory"."stock_move_serials" (
    "id" TEXT NOT NULL,
    "move_id" TEXT NOT NULL,
    "serial_id" TEXT NOT NULL,

    CONSTRAINT "stock_move_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."sales_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "customer_id" TEXT NOT NULL,
    "state" "sales"."SalesOrderState" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "fx_rate_at_confirm" DECIMAL(18,6),
    "payment_term_days" INTEGER NOT NULL DEFAULT 0,
    "delivery_address" TEXT,
    "notes" TEXT,
    "requires_backorder" BOOLEAN NOT NULL DEFAULT false,
    "subtotal_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "invoiced_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales"."sales_order_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'UN',
    "unit_price_ars" DECIMAL(18,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iva_rate" DECIMAL(5,2) NOT NULL,
    "quantity_delivered" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "quantity_invoiced" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "requires_backorder" BOOLEAN NOT NULL DEFAULT false,
    "reserve_move_id" TEXT,
    "subtotal_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases"."purchase_orders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "state" "purchases"."PurchaseOrderState" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fx_rate_at_confirm" DECIMAL(18,6),
    "expected_date" DATE,
    "delivery_address" TEXT,
    "notes" TEXT,
    "so_origin_id" TEXT,
    "subtotal_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subtotal_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_ars" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases"."purchase_order_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'UN',
    "unit_cost_usd" DECIMAL(18,4) NOT NULL,
    "iva_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "quantity_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "incoming_move_id" TEXT,
    "so_line_origin_id" TEXT,
    "subtotal_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_usd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cuit_key" ON "core"."tenants"("cuit");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "core"."users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "core"."users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "entities_tenant_id_is_active_idx" ON "core"."entities"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "entities_tenant_id_legal_name_idx" ON "core"."entities"("tenant_id", "legal_name");

-- CreateIndex
CREATE UNIQUE INDEX "entities_tenant_id_tax_id_key" ON "core"."entities"("tenant_id", "tax_id");

-- CreateIndex
CREATE INDEX "product_categories_tenant_id_idx" ON "inventory"."product_categories"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_tenant_id_name_parent_id_key" ON "inventory"."product_categories"("tenant_id", "name", "parent_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_is_active_idx" ON "inventory"."products"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "products_tenant_id_barcode_idx" ON "inventory"."products"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "products_tenant_id_name_idx" ON "inventory"."products"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "inventory"."products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "locations_tenant_id_location_type_idx" ON "inventory"."locations"("tenant_id", "location_type");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_code_key" ON "inventory"."locations"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_product_id_state_idx" ON "inventory"."stock_moves"("tenant_id", "product_id", "state");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_origin_doc_type_origin_doc_id_idx" ON "inventory"."stock_moves"("tenant_id", "origin_doc_type", "origin_doc_id");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_dest_location_id_state_idx" ON "inventory"."stock_moves"("tenant_id", "dest_location_id", "state");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_source_location_id_state_idx" ON "inventory"."stock_moves"("tenant_id", "source_location_id", "state");

-- CreateIndex
CREATE INDEX "stock_moves_tenant_id_scheduled_date_idx" ON "inventory"."stock_moves"("tenant_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "serial_numbers_tenant_id_status_idx" ON "inventory"."serial_numbers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "serial_numbers_tenant_id_current_location_id_idx" ON "inventory"."serial_numbers"("tenant_id", "current_location_id");

-- CreateIndex
CREATE UNIQUE INDEX "serial_numbers_tenant_id_product_id_serial_key" ON "inventory"."serial_numbers"("tenant_id", "product_id", "serial");

-- CreateIndex
CREATE INDEX "stock_move_serials_serial_id_idx" ON "inventory"."stock_move_serials"("serial_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_move_serials_move_id_serial_id_key" ON "inventory"."stock_move_serials"("move_id", "serial_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_state_idx" ON "sales"."sales_orders"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_customer_id_idx" ON "sales"."sales_orders"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "sales_orders_tenant_id_created_at_idx" ON "sales"."sales_orders"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenant_id_order_number_key" ON "sales"."sales_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_order_id_idx" ON "sales"."sales_order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenant_id_product_id_idx" ON "sales"."sales_order_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_lines_order_id_line_number_key" ON "sales"."sales_order_lines"("order_id", "line_number");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_state_idx" ON "purchases"."purchase_orders"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx" ON "purchases"."purchase_orders"("tenant_id", "supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_so_origin_id_idx" ON "purchases"."purchase_orders"("so_origin_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_order_number_key" ON "purchases"."purchase_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_order_id_idx" ON "purchases"."purchase_order_lines"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_product_id_idx" ON "purchases"."purchase_order_lines"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_order_id_line_number_key" ON "purchases"."purchase_order_lines"("order_id", "line_number");

-- AddForeignKey
ALTER TABLE "core"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."entities" ADD CONSTRAINT "entities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."product_categories" ADD CONSTRAINT "product_categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inventory"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "inventory"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."locations" ADD CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "inventory"."locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_moves" ADD CONSTRAINT "stock_moves_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_moves" ADD CONSTRAINT "stock_moves_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_moves" ADD CONSTRAINT "stock_moves_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "inventory"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_moves" ADD CONSTRAINT "stock_moves_dest_location_id_fkey" FOREIGN KEY ("dest_location_id") REFERENCES "inventory"."locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_moves" ADD CONSTRAINT "stock_moves_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "core"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."serial_numbers" ADD CONSTRAINT "serial_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."serial_numbers" ADD CONSTRAINT "serial_numbers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."serial_numbers" ADD CONSTRAINT "serial_numbers_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "inventory"."locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_move_serials" ADD CONSTRAINT "stock_move_serials_move_id_fkey" FOREIGN KEY ("move_id") REFERENCES "inventory"."stock_moves"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory"."stock_move_serials" ADD CONSTRAINT "stock_move_serials_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "inventory"."serial_numbers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "core"."entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_orders" ADD CONSTRAINT "sales_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "core"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales"."sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales"."sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases"."purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "core"."entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases"."purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "core"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchases"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases"."purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "inventory"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
