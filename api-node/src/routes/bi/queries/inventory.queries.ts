// api-node/src/routes/bi/queries/inventory.queries.ts

import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

export interface InventoryMetrics {
  total_skus: number;
  total_value: number;
  available_value: number;
  damaged_value: number;
  quarantine_value: number;
  accuracy: number;
  fill_rate: number;
  turnover_rate: number;
  stockout_rate: number;
  overstock_rate: number;
  days_on_hand: number;
}

export interface WarehouseMetrics {
  receiving_efficiency: number;
  picking_accuracy: number;
  cycle_count_accuracy: number;
  backorder_rate: number;
  shrinkage_rate: number;
}

export interface InventoryByZone {
  zone: string;
  total_units: number;
  available_units: number;
  damaged_units: number;
  quarantine_units: number;
  total_value: number;
  sku_count: number;
  utilization_rate: number;
}

export interface InventoryByCategory {
  category: string;
  items: number;
  quantity_on_hand: number;
  value: number;
  turnover: number;
  stockout_risk: 'low' | 'medium' | 'high';
  avg_days_on_hand: number;
}

export interface InventoryMovement {
  movement_id: number;
  date: string;
  product_name: string;
  sku: string;
  movement_type: string;
  quantity: number;
  from_location: string;
  to_location: string;
  value: number;
  user: string;
  reason: string;
}

export interface CycleCountDiscrepancy {
  cycle_count_id: number;
  sku: string;
  product: string;
  zone: string;
  bin_location: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  variance_value: number;
  count_date: string;
  status: string;
  counted_by: string;
}

export interface StockAlert {
  type: 'stockout' | 'low_stock' | 'overstock' | 'expiring' | 'damaged';
  sku: string;
  product_name: string;
  current_stock: number;
  min_quantity: number;
  max_quantity: number;
  reorder_point: number;
  days_of_stock: number;
  expiry_date: string | null;
}

export interface SlowMovingItem {
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  value: number;
  days_since_movement: number;
  last_movement_date: string;
  location_zone: string;
}

interface InventoryMetricsRow extends InventoryMetrics {
  stockout_count: number;
  overstock_count: number;
  avg_days_on_hand: number;
}

interface WarehouseMetricsRow extends WarehouseMetrics {
  shrinkage_value: number;
}

interface InventoryByZoneRow {
  zone: string | null;
  total_units: number;
  available_units: number;
  damaged_units: number;
  quarantine_units: number;
  total_value: number;
  sku_count: number;
  utilization_rate: number;
}

interface InventoryByCategoryRow {
  category: string;
  items: number;
  quantity_on_hand: number;
  value: number;
  avg_days_on_hand: number;
  turnover: number;
  stockout_risk: 'low' | 'medium' | 'high';
}

interface InventoryMovementRow {
  movement_id: number;
  date: string;
  product_name: string;
  sku: string;
  movement_type: string;
  quantity: number;
  from_location: string;
  to_location: string;
  value: number;
  user: string;
  reason: string;
}

interface CycleCountDiscrepancyRow {
  cycle_count_id: number;
  sku: string;
  product: string;
  zone: string;
  bin_location: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  variance_value: number;
  count_date: string;
  status: string;
  counted_by: string;
}

interface StockAlertRow {
  alert_type: StockAlert['type'] | null;
  sku: string;
  product_name: string;
  current_stock: number;
  min_quantity: number;
  max_quantity: number;
  reorder_point: number;
  days_of_stock: number;
  expiry_date: string | null;
}

interface SlowMovingItemRow {
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  value: number;
  days_since_movement: number;
  last_movement_date: string;
  location_zone: string;
}

export class InventoryQueries {
  
  /**
   * Get comprehensive inventory metrics with bulletproof NULL handling
   */
  static async getInventoryMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<InventoryMetrics> {
    app.log.info(`[INVENTORY QUERIES] getInventoryMetrics called with dates: ${startDate?.toISOString()} to ${endDate?.toISOString()}`);
    
    const query = `
      WITH current_inventory AS (
        SELECT 
          i.product_id,
          i.quantity_on_hand,
          COALESCE(i.reserved_quantity, 0) as reserved_quantity,
          COALESCE(i.damaged_quantity, 0) as damaged_quantity,
          COALESCE(i.quarantine_quantity, 0) as quarantine_quantity,
          COALESCE(i.unit_cost, p.cost, 0) as unit_cost,
          COALESCE(i.min_quantity, 0) as min_quantity,
          COALESCE(i.max_quantity, 999999) as max_quantity,
          COALESCE(i.reorder_point, 0) as reorder_point,
          i.quality_status,
          i.snapshot_timestamp
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots WHERE is_deleted = false)
          AND i.is_deleted = false
          AND p.is_deleted = false
      ),
      sales_data AS (
        SELECT
          product_id,
          COUNT(DISTINCT DATE(sale_datetime)) as days_with_sales,
          SUM(quantity * uom_ratio) as total_sold,
          SUM(quantity * uom_ratio) / NULLIF(COUNT(DISTINCT DATE(sale_datetime)), 0) as daily_velocity
        FROM sales_partitioned
        WHERE sale_datetime >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND sale_datetime < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
          AND is_deleted = false
        GROUP BY product_id
      ),
      inventory_stats AS (
        SELECT 
          COUNT(DISTINCT ci.product_id) as total_skus,
          SUM(ci.quantity_on_hand * ci.unit_cost) as total_value,
          SUM(CASE WHEN ci.quality_status = 'available' THEN ci.quantity_on_hand * ci.unit_cost ELSE 0 END) as available_value,
          SUM(CASE WHEN ci.quality_status = 'damaged' THEN ci.damaged_quantity * ci.unit_cost ELSE 0 END) as damaged_value,
          SUM(CASE WHEN ci.quality_status = 'quarantine' THEN ci.quarantine_quantity * ci.unit_cost ELSE 0 END) as quarantine_value,
          COUNT(*) FILTER (WHERE ci.quantity_on_hand <= ci.min_quantity AND ci.min_quantity > 0) as stockout_count,
          COUNT(*) FILTER (WHERE ci.quantity_on_hand >= ci.max_quantity AND ci.max_quantity < 999999) as overstock_count,
          AVG(CASE 
            WHEN COALESCE(sd.daily_velocity, 0) > 0 
            THEN ci.quantity_on_hand / NULLIF(sd.daily_velocity, 0)
            ELSE 0 
          END) as avg_days_on_hand
        FROM current_inventory ci
        LEFT JOIN sales_data sd ON ci.product_id = sd.product_id
      ),
      cycle_count_stats AS (
        SELECT 
          COUNT(*) as total_counts,
          COUNT(*) FILTER (WHERE ABS(variance) <= 2) as accurate_counts
        FROM cycle_counts
        WHERE count_date >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND count_date < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
      )
      SELECT 
        COALESCE(ist.total_skus, 0) as total_skus,
        COALESCE(ist.total_value, 0) as total_value,
        COALESCE(ist.available_value, 0) as available_value,
        COALESCE(ist.damaged_value, 0) as damaged_value,
        COALESCE(ist.quarantine_value, 0) as quarantine_value,
        COALESCE(
          (ccs.accurate_counts::FLOAT / NULLIF(ccs.total_counts, 0)::FLOAT * 100),
          95.0
        ) as accuracy,
        COALESCE(
          ((ist.total_skus - ist.stockout_count)::FLOAT / NULLIF(ist.total_skus, 0)::FLOAT * 100),
          100.0
        ) as fill_rate,
        COALESCE(
          CASE 
            WHEN ist.total_value > 0 AND ist.avg_days_on_hand > 0 
            THEN 365.0 / NULLIF(ist.avg_days_on_hand, 0)
            ELSE 0 
          END,
          0
        ) as turnover_rate,
        COALESCE(
          (ist.stockout_count::FLOAT / NULLIF(ist.total_skus, 0)::FLOAT * 100),
          0
        ) as stockout_rate,
        COALESCE(
          (ist.overstock_count::FLOAT / NULLIF(ist.total_skus, 0)::FLOAT * 100),
          0
        ) as overstock_rate,
        COALESCE(ist.avg_days_on_hand, 0) as days_on_hand
      FROM inventory_stats ist
      CROSS JOIN cycle_count_stats ccs
    `;

    const params = [startDate, endDate];

    const result = await QueryBuilder.executeWithDebug<InventoryMetricsRow[]>(
      app.prisma,
      query,
      params,
      'InventoryQueries.getInventoryMetrics'
    );

    const row = result[0] || {};
    const metrics = {
      total_skus: Number(row.total_skus) || 0,
      total_value: Number(row.total_value) || 0,
      available_value: Number(row.available_value) || 0,
      damaged_value: Number(row.damaged_value) || 0,
      quarantine_value: Number(row.quarantine_value) || 0,
      accuracy: Number(row.accuracy) || 95,
      fill_rate: Number(row.fill_rate) || 100,
      turnover_rate: Number(row.turnover_rate) || 0,
      stockout_rate: Number(row.stockout_rate) || 0,
      overstock_rate: Number(row.overstock_rate) || 0,
      days_on_hand: Number(row.days_on_hand) || 0
    };

    app.log.info({ metrics }, `[INVENTORY QUERIES] Returning metrics:`);
    return metrics;
  }

  /**
   * Get warehouse operational metrics with safe defaults
   */
  static async getWarehouseMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<WarehouseMetrics> {
    const query = `
      WITH receiving_stats AS (
        SELECT 
          COUNT(*) as total_receipts,
          COUNT(*) FILTER (WHERE created_at <= expected_delivery_date + INTERVAL '1 day') as on_time_receipts
        FROM purchases
        WHERE actual_delivery_date IS NOT NULL
          AND actual_delivery_date >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND actual_delivery_date < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
      ),
      picking_stats AS (
        SELECT
          COUNT(*) as total_picks,
          COUNT(*) FILTER (WHERE quantity > 0) as successful_picks
        FROM sales_partitioned
        WHERE sale_datetime >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND sale_datetime < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
          AND is_deleted = false
      ),
      cycle_count_stats AS (
        SELECT 
          COUNT(*) as total_counts,
          COUNT(*) FILTER (WHERE ABS(variance) <= 2) as accurate_counts,
          SUM(ABS(variance * variance_value)) as total_shrinkage_value
        FROM cycle_counts
        WHERE count_date >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND count_date < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
      ),
      backorder_stats AS (
        SELECT 
          COUNT(DISTINCT i.product_id) as total_products,
          COUNT(DISTINCT i.product_id) FILTER (WHERE i.quantity_on_hand <= 0) as out_of_stock_products
        FROM inventory_snapshots i
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
          AND i.is_deleted = false
      )
      SELECT 
        COALESCE(
          (rs.on_time_receipts::FLOAT / NULLIF(rs.total_receipts, 0)::FLOAT * 100),
          90.0
        ) as receiving_efficiency,
        COALESCE(
          (ps.successful_picks::FLOAT / NULLIF(ps.total_picks, 0)::FLOAT * 100),
          98.0
        ) as picking_accuracy,
        COALESCE(
          (ccs.accurate_counts::FLOAT / NULLIF(ccs.total_counts, 0)::FLOAT * 100),
          95.0
        ) as cycle_count_accuracy,
        COALESCE(
          (bs.out_of_stock_products::FLOAT / NULLIF(bs.total_products, 0)::FLOAT * 100),
          0
        ) as backorder_rate,
        COALESCE(ccs.total_shrinkage_value, 0) as shrinkage_value
      FROM receiving_stats rs
      CROSS JOIN picking_stats ps
      CROSS JOIN cycle_count_stats ccs
      CROSS JOIN backorder_stats bs
    `;

    const params = [startDate, endDate];

    const result = await QueryBuilder.executeWithDebug<WarehouseMetricsRow[]>(
      app.prisma,
      query,
      params,
      'InventoryQueries.getWarehouseMetrics'
    );

    const row = result[0] || {};
    return {
      receiving_efficiency: Number(row.receiving_efficiency) || 90,
      picking_accuracy: Number(row.picking_accuracy) || 98,
      cycle_count_accuracy: Number(row.cycle_count_accuracy) || 95,
      backorder_rate: Number(row.backorder_rate) || 0,
      shrinkage_rate: Number(row.shrinkage_value) || 0
    };
  }

  /**
   * Get inventory distribution by zone with full NULL safety
   */
  static async getInventoryByZone(app: AppWithPrisma): Promise<InventoryByZone[]> {
    const query = `
      SELECT 
        COALESCE(i.location_zone, 'MAIN') as zone,
        SUM(COALESCE(i.quantity_on_hand, 0)) as total_units,
        SUM(CASE WHEN COALESCE(i.quality_status, 'available') = 'available' THEN COALESCE(i.quantity_on_hand, 0) ELSE 0 END) as available_units,
        SUM(COALESCE(i.damaged_quantity, 0)) as damaged_units,
        SUM(COALESCE(i.quarantine_quantity, 0)) as quarantine_units,
        SUM(COALESCE(i.quantity_on_hand, 0) * COALESCE(i.unit_cost, p.cost, 0)) as total_value,
        COUNT(DISTINCT i.product_id) as sku_count,
        0 as utilization_rate
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots WHERE is_deleted = false)
        AND i.is_deleted = false
        AND p.is_deleted = false
      GROUP BY i.location_zone
      ORDER BY zone
    `;

    const result = await QueryBuilder.executeWithDebug<InventoryByZoneRow[]>(
      app.prisma,
      query,
      [],
      'InventoryQueries.getInventoryByZone'
    );

    return result.map(row => ({
      zone: row.zone || 'MAIN',
      total_units: Number(row.total_units) || 0,
      available_units: Number(row.available_units) || 0,
      damaged_units: Number(row.damaged_units) || 0,
      quarantine_units: Number(row.quarantine_units) || 0,
      total_value: Number(row.total_value) || 0,
      sku_count: Number(row.sku_count) || 0,
      utilization_rate: Number(row.utilization_rate) || 0
    }));
  }

  /**
   * Get inventory by category with stockout risk assessment
   */
  static async getInventoryByCategory(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<InventoryByCategory[]> {
    const query = `
      WITH sales_velocity AS (
        SELECT
          product_id,
          SUM(quantity * uom_ratio) / NULLIF(COUNT(DISTINCT DATE(sale_datetime)), 0) as daily_velocity
        FROM sales_partitioned
        WHERE sale_datetime >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
          AND sale_datetime < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
          AND is_deleted = false
        GROUP BY product_id
      )
      SELECT
        COALESCE(p.category, 'Sin Categoría') as category,
        COUNT(DISTINCT i.product_id) as items,
        SUM(COALESCE(i.quantity_on_hand, 0)) as quantity_on_hand,
        SUM(COALESCE(i.quantity_on_hand, 0) * COALESCE(i.unit_cost, p.cost, 0)) as value,
        AVG(CASE 
          WHEN COALESCE(sv.daily_velocity, 0) > 0 
          THEN COALESCE(i.quantity_on_hand, 0) / NULLIF(sv.daily_velocity, 0)
          ELSE 0 
        END) as avg_days_on_hand,
        CASE 
          WHEN AVG(COALESCE(i.quantity_on_hand, 0) / NULLIF(sv.daily_velocity, 1)) < 7 THEN 'high'
          WHEN AVG(COALESCE(i.quantity_on_hand, 0) / NULLIF(sv.daily_velocity, 1)) < 14 THEN 'medium'
          ELSE 'low'
        END as stockout_risk,
        COALESCE(
          365.0 / NULLIF(AVG(CASE 
            WHEN sv.daily_velocity > 0 
            THEN i.quantity_on_hand / NULLIF(sv.daily_velocity, 0)
            ELSE 0 
          END), 0),
          0
        ) as turnover
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN sales_velocity sv ON i.product_id = sv.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots WHERE is_deleted = false)
        AND i.is_deleted = false
        AND p.is_deleted = false
      GROUP BY p.category
      ORDER BY value DESC
    `;

    const params = [startDate, endDate];

    const result = await QueryBuilder.executeWithDebug<InventoryByCategoryRow[]>(
      app.prisma,
      query,
      params,
      'InventoryQueries.getInventoryByCategory'
    );

    return result.map(row => ({
      category: row.category || 'Sin Categoría',
      items: Number(row.items) || 0,
      quantity_on_hand: Number(row.quantity_on_hand) || 0,
      value: Number(row.value) || 0,
      turnover: Number(row.turnover) || 0,
      stockout_risk: row.stockout_risk || 'low',
      avg_days_on_hand: Number(row.avg_days_on_hand) || 0
    }));
  }

  /**
   * Get recent inventory movements with full audit trail
   */
  static async getInventoryMovements(app: AppWithPrisma, startDate?: Date, endDate?: Date, limit: number = 50): Promise<InventoryMovement[]> {
    const query = `
      SELECT 
        im.movement_id,
        im.created_at as date,
        COALESCE(p.product_name, 'Unknown Product') as product_name,
        COALESCE(p.sku, 'N/A') as sku,
        im.movement_type,
        COALESCE(im.quantity, 0) as quantity,
        COALESCE(im.from_location, '-') as from_location,
        COALESCE(im.to_location, '-') as to_location,
        COALESCE(im.total_value, im.quantity * im.unit_cost, 0) as value,
        COALESCE(u.username, 'System') as user,
        COALESCE(im.reason, '') as reason
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.product_id
      LEFT JOIN users u ON im.created_by = u.user_id
      WHERE im.created_at >= COALESCE($1, CURRENT_DATE - INTERVAL '30 days')
        AND im.created_at < COALESCE($2, CURRENT_DATE) + INTERVAL '1 day'
      ORDER BY im.created_at DESC
      LIMIT $3
    `;

    const params = [startDate, endDate, limit];

    const result = await QueryBuilder.executeWithDebug<InventoryMovementRow[]>(
      app.prisma,
      query,
      params,
      'InventoryQueries.getInventoryMovements'
    );

    return result.map(row => ({
      movement_id: Number(row.movement_id),
      date: row.date,
      product_name: row.product_name,
      sku: row.sku,
      movement_type: row.movement_type,
      quantity: Number(row.quantity) || 0,
      from_location: row.from_location,
      to_location: row.to_location,
      value: Number(row.value) || 0,
      user: row.user,
      reason: row.reason
    }));
  }

  /**
   * Get cycle count discrepancies requiring attention
   */
  static async getCycleCountDiscrepancies(app: AppWithPrisma, limit: number = 20): Promise<CycleCountDiscrepancy[]> {
    const query = `
      SELECT 
        cc.cycle_count_id,
        COALESCE(p.sku, 'N/A') as sku,
        COALESCE(p.product_name, 'Unknown Product') as product,
        COALESCE(cc.location_zone, 'MAIN') as zone,
        COALESCE(cc.bin_location, '-') as bin_location,
        COALESCE(cc.system_quantity, 0) as system_qty,
        COALESCE(cc.counted_quantity, 0) as counted_qty,
        COALESCE(cc.variance, 0) as variance,
        COALESCE(cc.variance_value, 0) as variance_value,
        cc.count_date,
        COALESCE(cc.status, 'pending') as status,
        COALESCE(u.username, 'Unknown') as counted_by
      FROM cycle_counts cc
      LEFT JOIN products p ON cc.product_id = p.product_id
      LEFT JOIN users u ON cc.counted_by = u.user_id
      WHERE cc.status IN ('pending', 'investigating')
      ORDER BY ABS(cc.variance) DESC, cc.count_date DESC
      LIMIT $1
    `;

    const result = await QueryBuilder.executeWithDebug<CycleCountDiscrepancyRow[]>(
      app.prisma,
      query,
      [limit],
      'InventoryQueries.getCycleCountDiscrepancies'
    );

    return result.map(row => ({
      cycle_count_id: Number(row.cycle_count_id),
      sku: row.sku,
      product: row.product,
      zone: row.zone,
      bin_location: row.bin_location,
      system_qty: Number(row.system_qty) || 0,
      counted_qty: Number(row.counted_qty) || 0,
      variance: Number(row.variance) || 0,
      variance_value: Number(row.variance_value) || 0,
      count_date: row.count_date,
      status: row.status,
      counted_by: row.counted_by
    }));
  }

  /**
   * Get stock alerts (stockouts, low stock, expiring, etc.)
   */
  static async getStockAlerts(app: AppWithPrisma, limit: number = 20): Promise<StockAlert[]> {
    const query = `
      WITH sales_velocity AS (
        SELECT
          product_id,
          SUM(quantity * uom_ratio) / NULLIF(COUNT(DISTINCT DATE(sale_datetime)), 0) as daily_velocity
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
          AND is_deleted = false
        GROUP BY product_id
      ),
      inventory_with_velocity AS (
        SELECT 
          p.sku,
          p.product_name,
          COALESCE(i.quantity_on_hand, 0) as current_stock,
          COALESCE(i.min_quantity, 0) as min_quantity,
          COALESCE(i.max_quantity, 999999) as max_quantity,
          COALESCE(i.reorder_point, 0) as reorder_point,
          i.expiry_date,
          CASE 
            WHEN COALESCE(sv.daily_velocity, 0) > 0 
            THEN i.quantity_on_hand / NULLIF(sv.daily_velocity, 0)
            ELSE 999 
          END as days_of_stock,
          CASE 
            WHEN COALESCE(i.quantity_on_hand, 0) <= 0 THEN 'stockout'
            WHEN COALESCE(i.quantity_on_hand, 0) <= COALESCE(i.reorder_point, i.min_quantity, 0) THEN 'low_stock'
            WHEN COALESCE(i.quantity_on_hand, 0) >= COALESCE(i.max_quantity, 999999) AND i.max_quantity < 999999 THEN 'overstock'
            WHEN i.expiry_date IS NOT NULL AND i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring'
            WHEN COALESCE(i.damaged_quantity, 0) > 0 THEN 'damaged'
            ELSE NULL
          END as alert_type
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        LEFT JOIN sales_velocity sv ON i.product_id = sv.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots WHERE is_deleted = false)
          AND i.is_deleted = false
          AND p.is_deleted = false
      )
      SELECT *
      FROM inventory_with_velocity
      WHERE alert_type IS NOT NULL
      ORDER BY 
        CASE alert_type
          WHEN 'stockout' THEN 1
          WHEN 'low_stock' THEN 2
          WHEN 'expiring' THEN 3
          WHEN 'damaged' THEN 4
          WHEN 'overstock' THEN 5
          ELSE 6
        END,
        days_of_stock ASC
      LIMIT $1
    `;

    const result = await QueryBuilder.executeWithDebug<StockAlertRow[]>(
      app.prisma,
      query,
      [limit],
      'InventoryQueries.getStockAlerts'
    );

    return result.map(row => ({
      type: (row.alert_type || 'low_stock'),
      sku: row.sku || 'N/A',
      product_name: row.product_name || 'Unknown',
      current_stock: Number(row.current_stock) || 0,
      min_quantity: Number(row.min_quantity) || 0,
      max_quantity: Number(row.max_quantity) || 999999,
      reorder_point: Number(row.reorder_point) || 0,
      days_of_stock: Number(row.days_of_stock) || 0,
      expiry_date: row.expiry_date
    }));
  }

  /**
   * Get slow moving items (no movement in 90+ days)
   */
  static async getSlowMovingItems(app: AppWithPrisma, limit: number = 20): Promise<SlowMovingItem[]> {
    const query = `
      WITH last_movements AS (
        SELECT 
          product_id,
          MAX(created_at) as last_movement_date
        FROM inventory_movements
        GROUP BY product_id
      )
      SELECT 
        COALESCE(p.sku, 'N/A') as sku,
        COALESCE(p.product_name, 'Unknown Product') as product_name,
        COALESCE(i.quantity_on_hand, 0) as quantity_on_hand,
        COALESCE(i.quantity_on_hand, 0) * COALESCE(i.unit_cost, p.cost, 0) as value,
        COALESCE(EXTRACT(DAY FROM NOW() - lm.last_movement_date), 999) as days_since_movement,
        COALESCE(lm.last_movement_date, i.snapshot_timestamp) as last_movement_date,
        COALESCE(i.location_zone, 'MAIN') as location_zone
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN last_movements lm ON i.product_id = lm.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots WHERE is_deleted = false)
        AND i.is_deleted = false
        AND p.is_deleted = false
        AND COALESCE(i.quantity_on_hand, 0) > 0
        AND COALESCE(EXTRACT(DAY FROM NOW() - lm.last_movement_date), 999) >= 90
      ORDER BY value DESC
      LIMIT $1
    `;

    const result = await QueryBuilder.executeWithDebug<SlowMovingItemRow[]>(
      app.prisma,
      query,
      [limit],
      'InventoryQueries.getSlowMovingItems'
    );

    return result.map(row => ({
      sku: row.sku || 'N/A',
      product_name: row.product_name || 'Unknown',
      quantity_on_hand: Number(row.quantity_on_hand) || 0,
      value: Number(row.value) || 0,
      days_since_movement: Number(row.days_since_movement) || 999,
      last_movement_date: row.last_movement_date,
      location_zone: row.location_zone || 'MAIN'
    }));
  }
}