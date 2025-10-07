-- System & Security Tables
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE user_roles (
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Core Business Tables
CREATE TABLE clients (
    client_id SERIAL PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    moq INTEGER -- Minimum Order Quantity
);

CREATE TABLE sales (
    sale_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    client_id INTEGER NOT NULL REFERENCES clients(client_id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12, 4) NOT NULL,
    total_price NUMERIC(14, 4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    sale_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE returns (
    return_id SERIAL PRIMARY KEY,
    sale_id INTEGER REFERENCES sales(sale_id), -- Optional: link return to a specific sale
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    client_id INTEGER NOT NULL REFERENCES clients(client_id),
    quantity INTEGER NOT NULL,
    return_reason TEXT,
    return_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE purchases (
    purchase_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity INTEGER NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL,
    total_cost NUMERIC(14, 4) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
    purchase_datetime TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_snapshots (
    snapshot_id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(product_id),
    quantity_on_hand INTEGER NOT NULL,
    snapshot_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full RBAC (add to existing)
CREATE TABLE permissions (
    permission_id SERIAL PRIMARY KEY,
    permission_name VARCHAR(50) UNIQUE NOT NULL,  -- e.g., 'act', 'recommendation'
    description TEXT
);

CREATE TABLE role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- Audit Logs (SSOT req)
CREATE TABLE audit_logs (
    log_id SERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id INTEGER NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),  -- Track changes
    old_values JSONB,
    new_values JSONB,
    changed_by INTEGER REFERENCES users(user_id),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for perf (sales/inventory queries; 80% reads)<grok-card data-id="817b60" data-type="citation_card"></grok-card>
CREATE INDEX idx_sales_product_client_date ON sales(product_id, client_id, sale_datetime);
CREATE INDEX idx_purchases_product_date ON purchases(product_id, purchase_datetime);
CREATE INDEX idx_inventory_product_timestamp ON inventory_snapshots(product_id, snapshot_timestamp);
CREATE INDEX idx_returns_product_client_date ON returns(product_id, client_id, return_datetime);

-- Soft deletes (enterprise: retain history)
ALTER TABLE sales ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE purchases ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
-- Repeat for others

-- Partition sales (date-based; scale to TBs)<grok-card data-id="45b180" data-type="citation_card"></grok-card>
CREATE TABLE sales_partitioned PARTITION BY RANGE (sale_datetime);
-- Add child tables: CREATE TABLE sales_2025 PARTITION OF sales_partitioned FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- Trigger for audits (auto-log changes)
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, changed_by)
        VALUES (TG_TABLE_NAME, OLD.sale_id, 'DELETE', row_to_json(OLD)::jsonb, 1);  -- Hardcode user_id temp
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO audit_logs (table_name, record_id, action, old_values, new_values, changed_by)
        VALUES (TG_TABLE_NAME, NEW.sale_id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, 1);
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO audit_logs (table_name, record_id, action, new_values, changed_by)
        VALUES (TG_TABLE_NAME, NEW.sale_id, 'INSERT', row_to_json(NEW)::jsonb, 1);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sales_audit AFTER INSERT OR UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER purchases AFTER INSERT OR UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER returns AFTER INSERT OR UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER inventory AFTER INSERT OR UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- RLS for RBAC (secure rows by user perms)<grok-card data-id="2846ce" data-type="citation_card"></grok-card>
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_policy ON sales
FOR ALL TO PUBLIC
USING (EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON ur.role_id = rp.role_id
               WHERE ur.user_id = current_setting('app.current_user_id')::int
               AND rp.permission_id IN (SELECT permission_id FROM permissions WHERE permission_name = 'act')));

-- Set in app: SET app.current_user_id = <user_id>;