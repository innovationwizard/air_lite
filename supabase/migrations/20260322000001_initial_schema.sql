-- ============================================================================
-- AI Refill Lite — Initial Database Schema
-- 24 tables: core business data, transactions, computed/derived, backtest, app
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- APP & AUTH
-- ============================================================================

-- Tenants (future multi-tenancy — single row for now)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  odoo_url VARCHAR(255),
  odoo_db VARCHAR(100),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id),
  display_name VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- App Settings (holding cost rate, backtest config, etc.)
CREATE TABLE app_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

-- Audit Log
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ============================================================================
-- CORE BUSINESS DATA (from Odoo CSV import)
-- ============================================================================

-- Units of Measure
CREATE TABLE units_of_measure (
  id SERIAL PRIMARY KEY,
  odoo_id INT UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  ratio NUMERIC(10,4) NOT NULL DEFAULT 1.0
);

-- Products
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  sku VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  subcategory VARCHAR(100),
  cost NUMERIC(15,4),
  list_price NUMERIC(15,4),
  stock_uom VARCHAR(50),
  stock_uom_ratio NUMERIC(10,4) DEFAULT 1.0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = true;

-- Customers (res.partner with customer_rank > 0)
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  city VARCHAR(100),
  department VARCHAR(100),
  customer_rank INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_name ON customers(name);

-- Suppliers (res.partner with supplier_rank > 0)
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  lead_time_days INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Product-Supplier relationships with pricing and lead times
CREATE TABLE product_suppliers (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  supplier_price NUMERIC(15,4),
  lead_time_days INT NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  min_order_qty NUMERIC(12,4) NOT NULL DEFAULT 1,
  UNIQUE(product_id, supplier_id)
);
CREATE INDEX idx_ps_product ON product_suppliers(product_id);
CREATE INDEX idx_ps_supplier ON product_suppliers(supplier_id);

-- Warehouses
CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Stock Locations (within warehouses)
CREATE TABLE stock_locations (
  id SERIAL PRIMARY KEY,
  odoo_id VARCHAR(50) UNIQUE,
  name VARCHAR(255) NOT NULL,
  warehouse_id INT REFERENCES warehouses(id),
  location_type VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX idx_sl_warehouse ON stock_locations(warehouse_id);
CREATE INDEX idx_sl_type ON stock_locations(location_type);

-- ============================================================================
-- TRANSACTION DATA
-- ============================================================================

-- Sales Orders (header)
CREATE TABLE sale_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  order_ref VARCHAR(50) NOT NULL,
  customer_id INT REFERENCES customers(id),
  order_date TIMESTAMPTZ NOT NULL,
  delivery_date TIMESTAMPTZ,
  effective_date TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL,
  warehouse_id INT REFERENCES warehouses(id),
  total NUMERIC(15,4),
  subtotal NUMERIC(15,4),
  salesperson VARCHAR(100),
  sales_team VARCHAR(100),
  pricelist VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_so_date ON sale_orders(order_date);
CREATE INDEX idx_so_state ON sale_orders(state);
CREATE INDEX idx_so_customer ON sale_orders(customer_id);
CREATE INDEX idx_so_warehouse ON sale_orders(warehouse_id);

-- Sales Order Lines
CREATE TABLE sale_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES sale_orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  quantity NUMERIC(12,4) NOT NULL,
  delivered_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
  invoiced_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
  uom VARCHAR(50),
  unit_price NUMERIC(15,4) NOT NULL,
  subtotal NUMERIC(15,4),
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sol_product ON sale_order_lines(product_id);
CREATE INDEX idx_sol_order ON sale_order_lines(order_id);

-- Purchase Orders (header)
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  order_ref VARCHAR(50) NOT NULL,
  supplier_id INT REFERENCES suppliers(id),
  order_date TIMESTAMPTZ,
  confirmation_date TIMESTAMPTZ,
  expected_delivery TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL,
  total NUMERIC(15,4),
  currency VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  exchange_rate NUMERIC(15,12),
  buyer VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_po_date ON purchase_orders(order_date);
CREATE INDEX idx_po_state ON purchase_orders(state);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);

-- Purchase Order Lines
CREATE TABLE purchase_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES purchase_orders(id),
  product_id INT NOT NULL REFERENCES products(id),
  description TEXT,
  quantity NUMERIC(12,4) NOT NULL,
  received_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
  uom VARCHAR(50),
  unit_price NUMERIC(15,4) NOT NULL,
  expected_delivery TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pol_product ON purchase_order_lines(product_id);
CREATE INDEX idx_pol_order ON purchase_order_lines(order_id);

-- Stock Moves (~967K rows — source of truth for inventory reconstruction)
CREATE TABLE stock_moves (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  odoo_id VARCHAR(50) UNIQUE,
  product_id INT NOT NULL REFERENCES products(id),
  quantity NUMERIC(12,4) NOT NULL,
  uom VARCHAR(50),
  from_location_id INT REFERENCES stock_locations(id),
  to_location_id INT REFERENCES stock_locations(id),
  move_date TIMESTAMPTZ NOT NULL,
  state VARCHAR(20) NOT NULL,
  origin VARCHAR(255),
  picking_ref VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sm_date ON stock_moves(move_date);
CREATE INDEX idx_sm_product ON stock_moves(product_id);
CREATE INDEX idx_sm_product_date ON stock_moves(product_id, move_date);
CREATE INDEX idx_sm_state ON stock_moves(state);
CREATE INDEX idx_sm_from_loc ON stock_moves(from_location_id);
CREATE INDEX idx_sm_to_loc ON stock_moves(to_location_id);

-- Stock Quants (point-in-time snapshot from Odoo — used for validation)
CREATE TABLE stock_quants (
  id SERIAL PRIMARY KEY,
  odoo_id VARCHAR(50) UNIQUE,
  product_id INT REFERENCES products(id),
  location_id INT REFERENCES stock_locations(id),
  quantity NUMERIC(12,4),
  reserved_qty NUMERIC(12,4) NOT NULL DEFAULT 0,
  entry_date TIMESTAMPTZ,
  uom VARCHAR(50),
  snapshot_date DATE NOT NULL
);
CREATE INDEX idx_sq_product ON stock_quants(product_id);

-- Exchange Rates (GTQ/USD daily)
CREATE TABLE exchange_rates (
  id SERIAL PRIMARY KEY,
  currency_from VARCHAR(10) NOT NULL DEFAULT 'USD',
  currency_to VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  rate NUMERIC(15,8) NOT NULL,
  rate_date DATE NOT NULL,
  UNIQUE(currency_from, currency_to, rate_date)
);
CREATE INDEX idx_er_date ON exchange_rates(rate_date);

-- ============================================================================
-- COMPUTED / DERIVED (built by data ingestion pipeline)
-- ============================================================================

-- Daily Inventory Position (reconstructed from stock_moves)
-- THE critical table for backtest: tells us inventory level on any given day
CREATE TABLE inventory_daily (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  warehouse_id INT NOT NULL REFERENCES warehouses(id),
  snapshot_date DATE NOT NULL,
  quantity_on_hand NUMERIC(12,4) NOT NULL,
  quantity_incoming NUMERIC(12,4) NOT NULL DEFAULT 0,
  quantity_outgoing NUMERIC(12,4) NOT NULL DEFAULT 0,
  net_available NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(15,4),
  inventory_value NUMERIC(15,4),
  UNIQUE(product_id, warehouse_id, snapshot_date)
);
CREATE INDEX idx_invd_date ON inventory_daily(snapshot_date);
CREATE INDEX idx_invd_product_date ON inventory_daily(product_id, snapshot_date);
CREATE INDEX idx_invd_warehouse ON inventory_daily(warehouse_id);

-- Daily Demand (aggregated from sale_order_lines, Census Filter applied)
CREATE TABLE demand_daily (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  demand_date DATE NOT NULL,
  quantity_sold NUMERIC(12,4) NOT NULL DEFAULT 0,
  revenue NUMERIC(15,4) NOT NULL DEFAULT 0,
  is_censored BOOLEAN NOT NULL DEFAULT false,
  orders_count INT NOT NULL DEFAULT 0,
  UNIQUE(product_id, demand_date)
);
CREATE INDEX idx_dd_date ON demand_daily(demand_date);
CREATE INDEX idx_dd_product_date ON demand_daily(product_id, demand_date);
CREATE INDEX idx_dd_censored ON demand_daily(is_censored) WHERE is_censored = true;

-- ============================================================================
-- BACKTEST ENGINE
-- ============================================================================

-- Backtest Runs (each cycle of the interactive backtest)
CREATE TABLE backtest_runs (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  training_start_date DATE NOT NULL,
  training_end_date DATE NOT NULL,
  prediction_month DATE NOT NULL,
  model_params JSONB,
  training_duration_ms INT,
  products_modeled INT,
  products_by_category INT NOT NULL DEFAULT 0,
  products_total_eligible INT,
  status VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_br_prediction ON backtest_runs(prediction_month);
CREATE INDEX idx_br_status ON backtest_runs(status);

-- Backtest Results (per-product predictions for each run)
CREATE TABLE backtest_results (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  model_type VARCHAR(20) NOT NULL DEFAULT 'individual'
    CHECK (model_type IN ('individual', 'category')),
  predicted_demand NUMERIC(12,4),
  actual_demand NUMERIC(12,4),
  predicted_demand_lower NUMERIC(12,4),
  predicted_demand_upper NUMERIC(12,4),
  error_absolute NUMERIC(12,4),
  error_percentage NUMERIC(8,4),
  predicted_reorder_point NUMERIC(12,4),
  predicted_safety_stock NUMERIC(12,4),
  actual_stockout_days INT NOT NULL DEFAULT 0,
  predicted_stockout_days INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_bres_run ON backtest_results(run_id);
CREATE INDEX idx_bres_product ON backtest_results(product_id);

-- Backtest Savings (headline numbers — 4 contractual goals per run)
CREATE TABLE backtest_savings (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,

  -- Goal 1: Reduced storage costs
  actual_storage_cost NUMERIC(15,4),
  optimized_storage_cost NUMERIC(15,4),
  storage_savings_gtq NUMERIC(15,4),
  storage_savings_pct NUMERIC(8,4),
  storage_reasoning TEXT,
  holding_cost_rate_used NUMERIC(8,4),

  -- Goal 2: Reduced unnecessary purchases
  actual_purchase_value NUMERIC(15,4),
  optimized_purchase_value NUMERIC(15,4),
  purchase_savings_gtq NUMERIC(15,4),
  purchase_savings_pct NUMERIC(8,4),
  purchase_reasoning TEXT,

  -- Goal 3: Reduced lost sales from stockouts
  actual_stockout_events INT,
  predicted_stockout_events INT,
  lost_revenue_actual NUMERIC(15,4),
  lost_revenue_optimized NUMERIC(15,4),
  stockout_savings_gtq NUMERIC(15,4),
  stockout_savings_pct NUMERIC(8,4),
  stockout_reasoning TEXT,

  -- Goal 4: Increased inventory rotation
  actual_turnover_rate NUMERIC(8,4),
  optimized_turnover_rate NUMERIC(8,4),
  rotation_improvement_pct NUMERIC(8,4),
  rotation_reasoning TEXT,

  -- Headline
  total_savings_gtq NUMERIC(15,4),
  summary_text TEXT
);
CREATE INDEX idx_bs_run ON backtest_savings(run_id);

-- ============================================================================
-- DEFAULT DATA
-- ============================================================================

-- Insert default app settings
INSERT INTO app_settings (tenant_id, key, value, description) VALUES
  (NULL, 'holding_cost_rate', '0.25', 'Tasa anual de costo de almacenamiento (25% = estándar industria plásticos/desechables, clima tropical)'),
  (NULL, 'backtest_max_products', '100', 'Número máximo de productos a modelar individualmente en cada ciclo de backtest'),
  (NULL, 'backtest_min_observations', '30', 'Mínimo de observaciones diarias no censuradas requeridas para modelar un producto individualmente'),
  (NULL, 'service_level_z_score', '1.65', 'Z-score para cálculo de stock de seguridad (1.65 = 95% nivel de servicio)'),
  (NULL, 'data_start_date', '"2024-10-01"', 'Fecha de inicio de los datos disponibles');

-- ============================================================================
-- ROW LEVEL SECURITY (prepared but not enforced until multi-tenancy)
-- ============================================================================

-- Enable RLS on all business tables (policies added when multi-tenancy activates)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;

-- Permissive policy for service role (bypasses RLS) — active now
-- When multi-tenancy activates, add tenant-scoped policies for anon/authenticated roles
CREATE POLICY "Service role full access" ON products FOR ALL USING (true);
CREATE POLICY "Service role full access" ON customers FOR ALL USING (true);
CREATE POLICY "Service role full access" ON suppliers FOR ALL USING (true);
CREATE POLICY "Service role full access" ON sale_orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON purchase_orders FOR ALL USING (true);
CREATE POLICY "Service role full access" ON stock_moves FOR ALL USING (true);
CREATE POLICY "Service role full access" ON backtest_runs FOR ALL USING (true);
