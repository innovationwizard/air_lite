-- ============================================================================
-- OA Module — RPC Functions
-- Net Inventory, Hot/Hold Lists, Compliance KPIs, Reception Saturation
-- ============================================================================

-- ============================================================================
-- 1. NET INVENTORY CALCULATION
-- Formula: (Physical Inventory + Confirmed Transits) - (Pending Customer Orders)
-- Returns per-product net inventory with days-of-supply classification
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_net_inventory(
  p_supplier_ids INT[] DEFAULT NULL
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  supplier_id INT,
  supplier_name VARCHAR,
  physical_inventory NUMERIC,
  confirmed_transits NUMERIC,
  pending_customer_orders NUMERIC,
  net_inventory NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply NUMERIC,
  buffer_status VARCHAR
) AS $$
DECLARE
  v_min_stock_days INT;
  v_max_stock_days INT;
BEGIN
  -- Load configurable thresholds
  SELECT COALESCE((value)::INT, 3) INTO v_min_stock_days
  FROM app_settings WHERE key = 'oa_min_stock_days' LIMIT 1;

  SELECT COALESCE((value)::INT, 7) INTO v_max_stock_days
  FROM app_settings WHERE key = 'oa_max_stock_weeks' LIMIT 1;
  v_max_stock_days := v_max_stock_days * 7; -- convert weeks to days

  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    ps_link.supplier_id,
    s.name AS supplier_name,

    -- Physical inventory (latest snapshot)
    COALESCE(inv.qty_on_hand, 0) AS physical_inventory,

    -- Confirmed transits: PO lines in state 'purchase' not yet fully received
    COALESCE(transit.qty_in_transit, 0) AS confirmed_transits,

    -- Pending customer orders: SO lines not yet fully delivered
    COALESCE(pending.qty_pending, 0) AS pending_customer_orders,

    -- Net Inventory
    (COALESCE(inv.qty_on_hand, 0) + COALESCE(transit.qty_in_transit, 0) - COALESCE(pending.qty_pending, 0)) AS net_inventory,

    -- Average daily demand (last 30 days, non-censored)
    COALESCE(dem.avg_demand, 0) AS avg_daily_demand,

    -- Days of supply
    CASE
      WHEN COALESCE(dem.avg_demand, 0) > 0
      THEN (COALESCE(inv.qty_on_hand, 0) + COALESCE(transit.qty_in_transit, 0) - COALESCE(pending.qty_pending, 0)) / dem.avg_demand
      ELSE 9999
    END AS days_of_supply,

    -- Buffer status classification
    CASE
      WHEN COALESCE(dem.avg_demand, 0) <= 0 THEN 'sin_demanda'
      WHEN (COALESCE(inv.qty_on_hand, 0) + COALESCE(transit.qty_in_transit, 0) - COALESCE(pending.qty_pending, 0)) / dem.avg_demand < v_min_stock_days THEN 'critical'
      WHEN (COALESCE(inv.qty_on_hand, 0) + COALESCE(transit.qty_in_transit, 0) - COALESCE(pending.qty_pending, 0)) / dem.avg_demand < 5 THEN 'low'
      WHEN (COALESCE(inv.qty_on_hand, 0) + COALESCE(transit.qty_in_transit, 0) - COALESCE(pending.qty_pending, 0)) / dem.avg_demand <= v_max_stock_days THEN 'optimal'
      ELSE 'excess'
    END AS buffer_status

  FROM products p
  -- Link product to supplier
  INNER JOIN product_suppliers ps_link ON ps_link.product_id = p.id
  INNER JOIN suppliers s ON s.id = ps_link.supplier_id
  -- Latest inventory snapshot
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS qty_on_hand
    FROM inventory_daily id
    WHERE id.product_id = p.id
      AND id.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_daily)
  ) inv ON true
  -- Confirmed transits (POs confirmed but not received)
  LEFT JOIN LATERAL (
    SELECT SUM(pol.quantity - COALESCE(pol.received_qty, 0)) AS qty_in_transit
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.order_id
    WHERE pol.product_id = p.id
      AND po.state IN ('purchase', 'locked')
      AND (pol.quantity - COALESCE(pol.received_qty, 0)) > 0
  ) transit ON true
  -- Pending customer orders (SOs confirmed but not delivered)
  LEFT JOIN LATERAL (
    SELECT SUM(sol.quantity - COALESCE(sol.delivered_qty, 0)) AS qty_pending
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
    WHERE sol.product_id = p.id
      AND so.state IN ('sale', 'done')
      AND (sol.quantity - COALESCE(sol.delivered_qty, 0)) > 0
  ) pending ON true
  -- Average daily demand (last 30 days)
  LEFT JOIN LATERAL (
    SELECT AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.product_id = p.id
      AND dd.is_censored = false
      AND dd.demand_date >= (SELECT MAX(snapshot_date) FROM inventory_daily) - INTERVAL '30 days'
  ) dem ON true
  WHERE p.is_active = true
    AND COALESCE(dem.avg_demand, 0) > 0
    AND (p_supplier_ids IS NULL OR ps_link.supplier_id = ANY(p_supplier_ids))
  ORDER BY days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. HOT LIST — Products with < 3 days of supply (Quiebre Inminente)
-- These must be loading priority for the next day
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_hot_list(
  p_supplier_ids INT[] DEFAULT NULL
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  supplier_id INT,
  supplier_name VARCHAR,
  net_inventory NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply NUMERIC,
  urgency_qty NUMERIC
) AS $$
DECLARE
  v_min_stock_days INT;
BEGIN
  SELECT COALESCE((value)::INT, 3) INTO v_min_stock_days
  FROM app_settings WHERE key = 'oa_min_stock_days' LIMIT 1;

  RETURN QUERY
  SELECT
    ni.product_id,
    ni.product_name,
    ni.sku,
    ni.category,
    ni.supplier_id,
    ni.supplier_name,
    ni.net_inventory,
    ni.avg_daily_demand,
    ni.days_of_supply,
    -- How much we need to get back to min buffer
    GREATEST(0, (v_min_stock_days * ni.avg_daily_demand) - ni.net_inventory) AS urgency_qty
  FROM rpc_oa_net_inventory(p_supplier_ids) ni
  WHERE ni.buffer_status = 'critical'
  ORDER BY ni.days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 3. HOLD LIST — Products with > 1 week buffer (Orden de Detención)
-- These dispatches should be stopped to free physical space
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_hold_list(
  p_supplier_ids INT[] DEFAULT NULL
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  supplier_id INT,
  supplier_name VARCHAR,
  net_inventory NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply NUMERIC,
  excess_qty NUMERIC,
  excess_days NUMERIC
) AS $$
DECLARE
  v_max_stock_days INT;
BEGIN
  SELECT COALESCE((value)::INT, 7) INTO v_max_stock_days
  FROM app_settings WHERE key = 'oa_max_stock_weeks' LIMIT 1;
  v_max_stock_days := v_max_stock_days * 7;

  RETURN QUERY
  SELECT
    ni.product_id,
    ni.product_name,
    ni.sku,
    ni.category,
    ni.supplier_id,
    ni.supplier_name,
    ni.net_inventory,
    ni.avg_daily_demand,
    ni.days_of_supply,
    -- How much excess inventory above the buffer
    GREATEST(0, ni.net_inventory - (v_max_stock_days * ni.avg_daily_demand)) AS excess_qty,
    GREATEST(0, ni.days_of_supply - v_max_stock_days) AS excess_days
  FROM rpc_oa_net_inventory(p_supplier_ids) ni
  WHERE ni.buffer_status = 'excess'
  ORDER BY ni.days_of_supply DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 4. COMPLIANCE KPIs — Weekly and Global fulfillment percentage
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_compliance(
  p_open_order_id INT
)
RETURNS TABLE(
  week_number INT,
  week_start DATE,
  week_end DATE,
  total_planned NUMERIC,
  total_dispatched NUMERIC,
  compliance_pct NUMERIC,
  alert_level VARCHAR
) AS $$
DECLARE
  v_threshold INT;
BEGIN
  SELECT COALESCE((value)::INT, 90) INTO v_threshold
  FROM app_settings WHERE key = 'oa_weekly_compliance_threshold' LIMIT 1;

  RETURN QUERY
  SELECT
    dpw.week_number,
    dpw.week_start,
    dpw.week_end,
    SUM(dpw.planned_qty) AS total_planned,
    SUM(dpw.dispatched_qty) AS total_dispatched,
    CASE
      WHEN SUM(dpw.planned_qty) > 0
      THEN ROUND((SUM(dpw.dispatched_qty) / SUM(dpw.planned_qty)) * 100, 1)
      ELSE 0
    END AS compliance_pct,
    CASE
      WHEN SUM(dpw.planned_qty) = 0 THEN 'sin_plan'
      WHEN (SUM(dpw.dispatched_qty) / NULLIF(SUM(dpw.planned_qty), 0)) * 100 < v_threshold THEN 'rojo'
      WHEN (SUM(dpw.dispatched_qty) / NULLIF(SUM(dpw.planned_qty), 0)) * 100 > 110 THEN 'amarillo'
      ELSE 'verde'
    END AS alert_level
  FROM dispatch_plan_weeks dpw
  WHERE dpw.open_order_id = p_open_order_id
  GROUP BY dpw.week_number, dpw.week_start, dpw.week_end
  ORDER BY dpw.week_number;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 5. GLOBAL COMPLIANCE — Month-to-date fulfillment
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_global_compliance(
  p_open_order_id INT
)
RETURNS TABLE(
  total_oa_qty NUMERIC,
  total_dispatched_qty NUMERIC,
  global_compliance_pct NUMERIC,
  weeks_completed INT,
  weeks_total INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    oo.total_forecast_qty AS total_oa_qty,
    COALESCE(SUM(dpw.dispatched_qty), 0) AS total_dispatched_qty,
    CASE
      WHEN oo.total_forecast_qty > 0
      THEN ROUND((COALESCE(SUM(dpw.dispatched_qty), 0) / oo.total_forecast_qty) * 100, 1)
      ELSE 0
    END AS global_compliance_pct,
    COUNT(*) FILTER (WHERE dpw.status = 'completed')::INT AS weeks_completed,
    COUNT(DISTINCT dpw.week_number)::INT AS weeks_total
  FROM open_orders oo
  LEFT JOIN dispatch_plan_weeks dpw ON dpw.open_order_id = oo.id
  WHERE oo.id = p_open_order_id
  GROUP BY oo.id, oo.total_forecast_qty;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 6. RECEPTION SATURATION — Check if day's unloading exceeds dock capacity
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_reception_saturation(
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  scheduled_date DATE,
  total_trucks INT,
  total_unload_hours NUMERIC,
  available_dock_hours NUMERIC,
  saturation_pct NUMERIC,
  is_saturated BOOLEAN,
  trucks JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH dock_capacity AS (
    SELECT
      COALESCE(wc.num_docks, 1) AS num_docks,
      EXTRACT(HOUR FROM (COALESCE(wc.working_hours_end, '17:00'::TIME) - COALESCE(wc.working_hours_start, '07:00'::TIME))) AS work_hours
    FROM warehouse_config wc
    LIMIT 1
  ),
  day_schedule AS (
    SELECT
      rs.scheduled_date,
      COUNT(*) AS truck_count,
      SUM(COALESCE(rs.estimated_unload_hours, 2)) AS total_hours,
      jsonb_agg(jsonb_build_object(
        'id', rs.id,
        'supplier_id', rs.supplier_id,
        'unit_type', rs.unit_type,
        'scheduled_time', rs.scheduled_time,
        'estimated_hours', COALESCE(rs.estimated_unload_hours, 2),
        'status', rs.status,
        'priority', rs.priority,
        'hot_list_products', rs.hot_list_products
      ) ORDER BY rs.priority DESC, rs.scheduled_time) AS trucks_json
    FROM reception_schedule rs
    WHERE rs.scheduled_date = p_date
      AND rs.status NOT IN ('cancelled', 'rescheduled')
    GROUP BY rs.scheduled_date
  )
  SELECT
    ds.scheduled_date,
    ds.truck_count::INT AS total_trucks,
    ds.total_hours AS total_unload_hours,
    (dc.num_docks * dc.work_hours)::NUMERIC AS available_dock_hours,
    CASE
      WHEN (dc.num_docks * dc.work_hours) > 0
      THEN ROUND((ds.total_hours / (dc.num_docks * dc.work_hours)) * 100, 1)
      ELSE 0
    END AS saturation_pct,
    ds.total_hours > (dc.num_docks * dc.work_hours) AS is_saturated,
    ds.trucks_json AS trucks
  FROM day_schedule ds
  CROSS JOIN dock_capacity dc;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 7. SUPPLIER TRAFFIC LIGHT — Verde/Amarillo/Rojo per product
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_supplier_semaphore(
  p_supplier_ids INT[] DEFAULT NULL
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  supplier_id INT,
  supplier_name VARCHAR,
  net_inventory NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply NUMERIC,
  semaphore VARCHAR,
  semaphore_reason TEXT
) AS $$
DECLARE
  v_min_stock_days INT;
  v_max_stock_days INT;
BEGIN
  SELECT COALESCE((value)::INT, 3) INTO v_min_stock_days
  FROM app_settings WHERE key = 'oa_min_stock_days' LIMIT 1;

  SELECT COALESCE((value)::INT, 7) INTO v_max_stock_days
  FROM app_settings WHERE key = 'oa_max_stock_weeks' LIMIT 1;
  v_max_stock_days := v_max_stock_days * 7;

  RETURN QUERY
  SELECT
    ni.product_id,
    ni.product_name,
    ni.sku,
    ni.supplier_id,
    ni.supplier_name,
    ni.net_inventory,
    ni.avg_daily_demand,
    ni.days_of_supply,
    CASE
      WHEN ni.days_of_supply < v_min_stock_days THEN 'rojo'
      WHEN ni.days_of_supply < 5 THEN 'amarillo'
      WHEN ni.days_of_supply <= v_max_stock_days THEN 'verde'
      ELSE 'hold'
    END AS semaphore,
    CASE
      WHEN ni.days_of_supply < v_min_stock_days
        THEN 'Necesidad de Ampliación de OA — Pedido Extraordinario por aceleración de demanda'
      WHEN ni.days_of_supply < 5
        THEN 'Sugerencia de adelantar despachos de la próxima semana'
      WHEN ni.days_of_supply <= v_max_stock_days
        THEN 'Orden Abierta fluyendo según lo pactado'
      ELSE 'Detener despachos — exceso de inventario sobre buffer de seguridad'
    END AS semaphore_reason
  FROM rpc_oa_net_inventory(p_supplier_ids) ni
  ORDER BY
    CASE
      WHEN ni.days_of_supply < v_min_stock_days THEN 1
      WHEN ni.days_of_supply < 5 THEN 2
      WHEN ni.days_of_supply <= v_max_stock_days THEN 3
      ELSE 4
    END,
    ni.days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;
