-- ============================================================================
-- OA Module — Open Order Management (Órdenes Abiertas)
-- Manages supply flow for Carvajal (79 trucks/month) & Reyma (40 trucks/month)
-- Source: Especificaciones.pdf
-- ============================================================================

-- ============================================================================
-- 1. OPEN ORDERS (Monthly OA per supplier)
-- ============================================================================

CREATE TABLE open_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  month DATE NOT NULL, -- first day of the target month
  total_forecast_qty NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_forecast_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed', 'cancelled')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, supplier_id, month)
);

CREATE INDEX idx_open_orders_supplier ON open_orders(supplier_id);
CREATE INDEX idx_open_orders_month ON open_orders(month);

-- ============================================================================
-- 2. OPEN ORDER LINES (per SKU within an OA)
-- ============================================================================

CREATE TABLE open_order_lines (
  id SERIAL PRIMARY KEY,
  open_order_id INT NOT NULL REFERENCES open_orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  forecast_qty NUMERIC(15,2) NOT NULL,
  unit_price NUMERIC(15,4),
  forecast_value NUMERIC(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oa_lines_order ON open_order_lines(open_order_id);
CREATE INDEX idx_oa_lines_product ON open_order_lines(product_id);

-- ============================================================================
-- 3. DISPATCH PLAN WEEKS (AI-generated S1-S4 weekly distribution)
-- ============================================================================

CREATE TABLE dispatch_plan_weeks (
  id SERIAL PRIMARY KEY,
  open_order_id INT NOT NULL REFERENCES open_orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  week_number INT NOT NULL CHECK (week_number BETWEEN 1 AND 5),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  planned_qty NUMERIC(15,2) NOT NULL DEFAULT 0,
  dispatched_qty NUMERIC(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'adjusted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispatch_plan_order ON dispatch_plan_weeks(open_order_id);
CREATE INDEX idx_dispatch_plan_product ON dispatch_plan_weeks(product_id);
CREATE INDEX idx_dispatch_plan_week ON dispatch_plan_weeks(week_start, week_end);

-- ============================================================================
-- 4. WAREHOUSE CONFIG (operational parameters — docks, hours, capacity)
-- ============================================================================

CREATE TABLE warehouse_config (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  warehouse_id INT REFERENCES warehouses(id),
  warehouse_label VARCHAR(255),
  num_docks INT NOT NULL DEFAULT 1,
  working_hours_start TIME NOT NULL DEFAULT '07:00',
  working_hours_end TIME NOT NULL DEFAULT '17:00',
  max_capacity_m3 NUMERIC(15,2),
  dock_cleanup_minutes INT NOT NULL DEFAULT 30,
  overtime_threshold TIME NOT NULL DEFAULT '16:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. UNLOADING TIMES (per unit type per supplier)
-- ============================================================================

CREATE TABLE unloading_times (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  supplier_id INT REFERENCES suppliers(id),
  unit_type VARCHAR(50) NOT NULL
    CHECK (unit_type IN ('furgon_53', 'contenedor_40', 'contenedor_45', 'camion_local')),
  estimated_hours NUMERIC(5,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, supplier_id, unit_type)
);

-- ============================================================================
-- 6. RECEPTION SCHEDULE (daily truck arrival programming)
-- ============================================================================

CREATE TABLE reception_schedule (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  warehouse_id INT REFERENCES warehouses(id),
  supplier_id INT REFERENCES suppliers(id),
  open_order_id INT REFERENCES open_orders(id),
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  unit_type VARCHAR(50) NOT NULL
    CHECK (unit_type IN ('furgon_53', 'contenedor_40', 'contenedor_45', 'camion_local')),
  estimated_unload_hours NUMERIC(5,2),
  dock_assigned INT,
  priority INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'arrived', 'unloading', 'completed', 'cancelled', 'rescheduled')),
  hot_list_products JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reception_date ON reception_schedule(scheduled_date);
CREATE INDEX idx_reception_supplier ON reception_schedule(supplier_id);
CREATE INDEX idx_reception_status ON reception_schedule(status);

-- ============================================================================
-- 7. WEEKLY AUDITS (Friday inventory snapshots)
-- ============================================================================

CREATE TABLE weekly_audits (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  audit_date DATE NOT NULL,
  product_id INT NOT NULL REFERENCES products(id),
  supplier_id INT REFERENCES suppliers(id),
  physical_inventory NUMERIC(15,2) NOT NULL DEFAULT 0,
  confirmed_transits NUMERIC(15,2) NOT NULL DEFAULT 0,
  pending_customer_orders NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_inventory NUMERIC(15,2) NOT NULL DEFAULT 0,
  avg_daily_demand NUMERIC(15,4) NOT NULL DEFAULT 0,
  days_of_supply NUMERIC(10,2) NOT NULL DEFAULT 0,
  buffer_status VARCHAR(20) NOT NULL
    CHECK (buffer_status IN ('critical', 'low', 'optimal', 'excess')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_weekly_audit_date ON weekly_audits(audit_date);
CREATE INDEX idx_weekly_audit_product ON weekly_audits(product_id);
CREATE INDEX idx_weekly_audit_status ON weekly_audits(buffer_status);

-- ============================================================================
-- 8. EXTRAORDINARY ORDERS (dynamic quota adjustments)
-- ============================================================================

CREATE TABLE extraordinary_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  open_order_id INT REFERENCES open_orders(id),
  supplier_id INT NOT NULL REFERENCES suppliers(id),
  trigger_date DATE NOT NULL,
  reason VARCHAR(30) NOT NULL
    CHECK (reason IN ('demand_exceeded_forecast', 'supplier_delay', 'route_deviation')),
  reason_detail TEXT,
  forecast_deviation_pct NUMERIC(10,2),
  status VARCHAR(20) NOT NULL DEFAULT 'recommended'
    CHECK (status IN ('recommended', 'approved', 'sent', 'received', 'cancelled')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extraordinary_supplier ON extraordinary_orders(supplier_id);
CREATE INDEX idx_extraordinary_status ON extraordinary_orders(status);

-- ============================================================================
-- 9. EXTRAORDINARY ORDER LINES
-- ============================================================================

CREATE TABLE extraordinary_order_lines (
  id SERIAL PRIMARY KEY,
  extraordinary_order_id INT NOT NULL REFERENCES extraordinary_orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  current_net_inventory NUMERIC(15,2),
  required_qty NUMERIC(15,2) NOT NULL,
  buffer_restore_qty NUMERIC(15,2),
  lead_time_cover_qty NUMERIC(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extra_lines_order ON extraordinary_order_lines(extraordinary_order_id);

-- ============================================================================
-- 10. OA-SPECIFIC APP SETTINGS (defaults)
-- ============================================================================

INSERT INTO app_settings (key, value, description) VALUES
  ('oa_max_stock_weeks', '1', 'Buffer de seguridad maximo: 1 semana de inventario (25% del forecast mensual)'),
  ('oa_min_stock_days', '3', 'Stock minimo antes de alerta de quiebre: 3 dias de inventario'),
  ('oa_weekly_compliance_threshold', '90', 'Umbral de cumplimiento semanal (%) — por debajo dispara alerta roja'),
  ('oa_reception_dock_cleanup_min', '30', 'Margen de tiempo entre unidades en rampa (minutos)')
ON CONFLICT (tenant_id, key) DO NOTHING;
