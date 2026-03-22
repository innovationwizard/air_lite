-- Initial schema migration for AIRefill database
-- Generated from Prisma schema

-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
    "user_id" SERIAL PRIMARY KEY,
    "username" VARCHAR(50) UNIQUE NOT NULL,
    "email" VARCHAR(100) UNIQUE NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- Create roles table
CREATE TABLE IF NOT EXISTS "roles" (
    "role_id" SERIAL PRIMARY KEY,
    "role_name" VARCHAR(50) UNIQUE NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- Create user_roles table
CREATE TABLE IF NOT EXISTS "user_roles" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY ("user_id", "role_id"),
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE,
    FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE
);

-- Create permissions table
CREATE TABLE IF NOT EXISTS "permissions" (
    "permission_id" SERIAL PRIMARY KEY,
    "permission_name" VARCHAR(100) UNIQUE NOT NULL,
    "description" TEXT NOT NULL
);

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    PRIMARY KEY ("role_id", "permission_id"),
    FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE,
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE
);

-- Create api_keys table
CREATE TABLE IF NOT EXISTS "api_keys" (
    "key_id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "api_key" VARCHAR(64) UNIQUE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE
);

-- Create clients table
CREATE TABLE IF NOT EXISTS "clients" (
    "client_id" SERIAL PRIMARY KEY,
    "client_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- Create products table
CREATE TABLE IF NOT EXISTS "products" (
    "product_id" SERIAL PRIMARY KEY,
    "product_name" VARCHAR(100) NOT NULL,
    "sku" VARCHAR(100),
    "cost" DECIMAL(12, 4),
    "category" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- Create sales_partitioned table
CREATE TABLE IF NOT EXISTS "sales_partitioned" (
    "sale_id" SERIAL PRIMARY KEY,
    "product_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12, 4) NOT NULL,
    "sale_datetime" TIMESTAMPTZ(6) NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("product_id") REFERENCES "products"("product_id"),
    FOREIGN KEY ("client_id") REFERENCES "clients"("client_id")
);

-- Create returns table
CREATE TABLE IF NOT EXISTS "returns" (
    "return_id" SERIAL PRIMARY KEY,
    "sale_id" INTEGER,
    "product_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "return_reason" TEXT,
    "return_datetime" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("sale_id") REFERENCES "sales_partitioned"("sale_id"),
    FOREIGN KEY ("product_id") REFERENCES "products"("product_id"),
    FOREIGN KEY ("client_id") REFERENCES "clients"("client_id")
);

-- Create purchases table
CREATE TABLE IF NOT EXISTS "purchases" (
    "purchase_id" SERIAL PRIMARY KEY,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(12, 4) NOT NULL,
    "purchase_datetime" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("product_id") REFERENCES "products"("product_id")
);

-- Create inventory_snapshots table
CREATE TABLE IF NOT EXISTS "inventory_snapshots" (
    "snapshot_id" SERIAL PRIMARY KEY,
    "product_id" INTEGER NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL,
    "snapshot_timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("product_id") REFERENCES "products"("product_id")
);

-- Create dashboards table
CREATE TABLE IF NOT EXISTS "dashboards" (
    "dashboard_id" SERIAL PRIMARY KEY,
    "dashboard_name" VARCHAR(255) NOT NULL,
    "role_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY ("role_id") REFERENCES "roles"("role_id")
);

-- Create dashboard_permissions table
CREATE TABLE IF NOT EXISTS "dashboard_permissions" (
    "dashboard_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,
    PRIMARY KEY ("dashboard_id", "permission_id"),
    FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("dashboard_id") ON DELETE CASCADE,
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "log_id" SERIAL PRIMARY KEY,
    "table_name" VARCHAR(50) NOT NULL,
    "operation" CHAR(1) NOT NULL,
    "record_id" INTEGER NOT NULL,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_by" INTEGER NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    FOREIGN KEY ("changed_by") REFERENCES "users"("user_id")
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "idx_users_username" ON "users"("username");
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users"("email");
CREATE INDEX IF NOT EXISTS "idx_sales_datetime" ON "sales_partitioned"("sale_datetime");
CREATE INDEX IF NOT EXISTS "idx_sales_product" ON "sales_partitioned"("product_id");
CREATE INDEX IF NOT EXISTS "idx_sales_client" ON "sales_partitioned"("client_id");
CREATE INDEX IF NOT EXISTS "idx_returns_datetime" ON "returns"("return_datetime");
CREATE INDEX IF NOT EXISTS "idx_purchases_datetime" ON "purchases"("purchase_datetime");
CREATE INDEX IF NOT EXISTS "idx_inventory_snapshots_timestamp" ON "inventory_snapshots"("snapshot_timestamp");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_table_record" ON "audit_logs"("table_name", "record_id");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_changed_at" ON "audit_logs"("changed_at");
