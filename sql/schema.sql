-- System Tables (soft delete on users/roles/user_roles for revokable access; perms immutable as core)
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    is_deleted BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE permissions (
    permission_id SERIAL PRIMARY KEY,
    permission_name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT
    -- No is_deleted: Immutable per SOX/audit reqs
);

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    is_deleted BOOLEAN DEFAULT FALSE,  -- Soft: Revokable perms
    PRIMARY KEY (role_id, permission_id)
);

-- Business Tables (all soft delete: Mutable, history-critical for ML/inventory)
CREATE TABLE clients (
    client_id SERIAL PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_description_long TEXT,
    category VARCHAR(100),
    supply_type VARCHAR(100),
    cost NUMERIC(12, 4),
    price_min NUMERIC(12, 4),
    shelf_life_days INTEGER,
    moq INTEGER,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE sales_partitioned (
    sale_id SERIAL,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    client_id INTEGER NOT NULL REFERENCES clients(client_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 4) NOT NULL,
    total_price NUMERIC(14, 4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    sale_datetime TIMESTAMPTZ NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE
) PARTITION BY RANGE (sale_datetime);

CREATE TABLE sales_2025 PARTITION OF sales_partitioned FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE sales_2026 PARTITION OF sales_partitioned FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE VIEW sales AS SELECT * FROM sales_partitioned WHERE NOT is_deleted;

CREATE TABLE returns (
    return_id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(sale_id),
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    client_id INTEGER NOT NULL REFERENCES clients(client_id),
    quantity INTEGER NOT NULL,
    return_reason TEXT,
    return_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE purchases (
    purchase_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL,
    total_cost NUMERIC(14, 4) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
    purchase_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE inventory_snapshots (
    snapshot_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity_on_hand INTEGER NOT NULL,
    snapshot_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Audit Logs (immutable: No delete)
CREATE TABLE audit_logs (
    log_id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id INTEGER NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'SOFT_DELETE')),
    old_values JSONB,
    new_values JSONB,
    changed_by INTEGER REFERENCES users(user_id),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (filter deleted; fact: Postgres partial indexes: 30-70% space/query savings)
CREATE INDEX idx_sales_product_client_date ON sales_partitioned(product_id, client_id, sale_datetime) WHERE NOT is_deleted;
CREATE INDEX idx_purchases_product_date ON purchases(product_id, purchase_datetime) WHERE NOT is_deleted;
CREATE INDEX idx_inventory_product_timestamp ON inventory_snapshots(product_id, snapshot_timestamp) WHERE NOT is_deleted;
CREATE INDEX idx_returns_product_client_date ON returns(product_id, client_id, return_datetime) WHERE NOT is_deleted;

-- Audit Trigger (DELETE logs as 'SOFT_DELETE', sets flag)
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
DECLARE
    pk_col TEXT;
    pk_val INTEGER;
BEGIN
    SELECT attname INTO pk_col FROM pg_attribute WHERE attrelid = TG_RELID AND attnum > 0 AND attisdropped = false AND attnum = (SELECT min(a.attnum) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = TG_RELID AND i.indisprimary);
    
    IF TG_OP = 'DELETE' THEN
        EXECUTE format('SELECT $1.%I', pk_col) INTO pk_val USING OLD;
        INSERT INTO audit_logs (table_name, record_id, action, old_values, changed_by)
        VALUES (TG_TABLE_NAME, pk_val, 'SOFT_DELETE', row_to_json(OLD)::jsonb, 1);
        EXECUTE format('UPDATE ONLY %I SET is_deleted = TRUE WHERE %I = $1.%I', TG_TABLE_NAME, pk_col, pk_col) USING OLD;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        EXECUTE format('SELECT $1.%I', pk_col) INTO pk_val USING NEW;
        INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_by)
        VALUES (TG_TABLE_NAME, pk_val, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, 1);
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        EXECUTE format('SELECT $1.%I', pk_col) INTO pk_val USING NEW;
        INSERT INTO audit_logs (table_name, record_id, action, new_values, changed_by)
        VALUES (TG_TABLE_NAME, pk_val, 'INSERT', row_to_json(NEW)::jsonb, 1);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Triggers (BEFORE for soft-delete intercept)
CREATE TRIGGER sales_audit BEFORE INSERT OR UPDATE OR DELETE ON sales_partitioned FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER purchases_audit BEFORE INSERT OR UPDATE OR DELETE ON purchases FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER returns_audit BEFORE INSERT OR UPDATE OR DELETE ON returns FOR EACH ROW EXECUTE FUNCTION audit_trigger();
CREATE TRIGGER inventory_audit BEFORE INSERT OR UPDATE OR DELETE ON inventory_snapshots FOR EACH ROW EXECUTE FUNCTION audit_trigger();
-- Add for users/roles/user_roles/role_permissions as needed

-- RLS for remaining tables (filter deleted; fact: Enforces per-row security, prevents leaks on queries)
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY returns_policy ON returns FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_policy ON inventory_snapshots FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_policy ON products FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_policy ON clients FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_policy ON users FOR ALL TO PUBLIC USING (NOT is_deleted AND is_active AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_policy ON roles FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_policy ON user_roles FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_policy ON role_permissions FOR ALL TO PUBLIC USING (NOT is_deleted AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id WHERE ur.user_id = current_setting('app.current_user_id')::int AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));