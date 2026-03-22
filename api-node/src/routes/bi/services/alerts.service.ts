import { DashboardAlert, FinancialAlert, AppWithPrisma } from '../types';
import { QueryBuilder } from '../utils/query-builder';

interface FinancialAlertRow {
  alert_type: string | null;
  sku: string;
  product_name: string;
  value_at_risk: number | null;
}

interface StockoutAlertRow {
  sku: string;
  product_name: string;
  current_stock: number | null;
  week_demand: number | null;
  days_of_stock: number | null;
}

interface OverstockAlertRow {
  sku: string;
  product_name: string;
  quantity_on_hand: number | null;
  daily_sales: number | null;
  value_at_risk: number | null;
  days_of_stock: number | null;
}

interface ExpiryAlertRow {
  sku: string;
  product_name: string;
  quantity_on_hand: number | null;
  shelf_life_days: number | null;
  days_in_inventory: number | null;
  days_until_expiry: number | null;
  value_at_risk: number | null;
}

export class AlertsService {
  static async getFinancialAlerts(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<FinancialAlert[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        CASE 
          WHEN i.quantity_on_hand * p.cost > 50000 AND s.daily_sales < 1 
          THEN 'HIGH_VALUE_SLOW_MOVER'
          WHEN EXTRACT(days FROM NOW() - i.snapshot_timestamp) > p.shelf_life_days * 0.8 
          THEN 'NEAR_EXPIRY'
          WHEN p.cost > 1000 AND i.quantity_on_hand > r.recommended_quantity * 3
          THEN 'OVERSTOCK_HIGH_VALUE'
        END as alert_type,
        p.sku,
        p.product_name,
        i.quantity_on_hand * p.cost as value_at_risk
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN recommendations r ON i.product_id = r.product_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned 
        ${dateCondition}
        GROUP BY product_id
      ) s ON i.product_id = s.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
        AND (
          (i.quantity_on_hand * p.cost > 50000 AND COALESCE(s.daily_sales, 0) < 1) OR
          (EXTRACT(days FROM NOW() - i.snapshot_timestamp) > p.shelf_life_days * 0.8) OR
          (p.cost > 1000 AND i.quantity_on_hand > COALESCE(r.recommended_quantity, 10) * 3)
        )
      LIMIT 5
    `;

    const rows = await QueryBuilder.executeWithDebug<FinancialAlertRow[]>(
      app.prisma,
      query,
      params,
      'getFinancialAlerts'
    );

    return rows
      .filter((row): row is FinancialAlertRow & { alert_type: string } => Boolean(row.alert_type))
      .map((row) => ({
        alert_type: row.alert_type,
        sku: row.sku,
        product_name: row.product_name,
        value_at_risk: row.value_at_risk ?? 0
      }));
  }

  static async getStockoutAlerts(
    app: AppWithPrisma,
    startDate?: Date,
    endDate?: Date,
    limit: number = 5
  ): Promise<DashboardAlert[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        p.sku,
        p.product_name,
        COALESCE(i.quantity_on_hand, 0) as current_stock,
        COALESCE(s.daily_sales * 7, 0) as week_demand,
        CASE 
          WHEN i.quantity_on_hand = 0 THEN 0
          WHEN s.daily_sales > 0 THEN i.quantity_on_hand / s.daily_sales
          ELSE 999
        END as days_of_stock
      FROM products p
      LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY product_id
      ) s ON p.product_id = s.product_id
      WHERE p.is_deleted = false
        AND COALESCE(i.quantity_on_hand, 0) < COALESCE(s.daily_sales * 7, 1)
      ORDER BY days_of_stock
      LIMIT ${limit}
    `;

    const results = await QueryBuilder.executeWithDebug<StockoutAlertRow[]>(
      app.prisma,
      query,
      params,
      'getStockoutAlerts'
    );

    return results.map((item, index) => ({
      id: `stockout-${index}`,
      severity: item.days_of_stock === 0 ? 'critical' : 'warning',
      type: 'stockout_risk',
      message: `${item.product_name} (${item.sku}) has ${item.days_of_stock ?? 0} days of stock remaining`,
      product: item.sku,
      actionRequired: true,
      impact: (item.week_demand ?? 0) * 10 // Estimated impact
    }));
  }

  static async getOverstockAlerts(
    app: AppWithPrisma,
    startDate?: Date,
    endDate?: Date,
    limit: number = 5
  ): Promise<DashboardAlert[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        p.sku,
        p.product_name,
        i.quantity_on_hand,
        COALESCE(s.daily_sales, 0) as daily_sales,
        i.quantity_on_hand * p.cost as value_at_risk,
        CASE 
          WHEN s.daily_sales > 0 THEN i.quantity_on_hand / s.daily_sales
          ELSE 999
        END as days_of_stock
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY product_id
      ) s ON i.product_id = s.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
        AND i.quantity_on_hand > COALESCE(s.daily_sales * 90, 10) -- More than 90 days of stock
        AND i.quantity_on_hand * p.cost > 10000 -- High value items
      ORDER BY value_at_risk DESC
      LIMIT ${limit}
    `;

    const results = await QueryBuilder.executeWithDebug<OverstockAlertRow[]>(
      app.prisma,
      query,
      params,
      'getOverstockAlerts'
    );

    return results.map((item, index) => {
      const daysOfStock = item.days_of_stock ?? 0;
      return {
        id: `overstock-${index}`,
        severity: daysOfStock > 180 ? 'critical' : 'warning',
        type: 'overstock_risk',
        message: `${item.product_name} (${item.sku}) has ${Math.round(daysOfStock)} days of stock (${item.quantity_on_hand ?? 0} units)`,
        product: item.sku,
        actionRequired: true,
        impact: item.value_at_risk ?? 0
      };
    });
  }

  static async getExpiryAlerts(app: AppWithPrisma, limit: number = 5): Promise<DashboardAlert[]> {
    const query = `
      SELECT 
        p.sku,
        p.product_name,
        i.quantity_on_hand,
        p.shelf_life_days,
        EXTRACT(days FROM NOW() - i.snapshot_timestamp) as days_in_inventory,
        p.shelf_life_days - EXTRACT(days FROM NOW() - i.snapshot_timestamp) as days_until_expiry,
        i.quantity_on_hand * p.cost as value_at_risk
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
        AND p.shelf_life_days IS NOT NULL
        AND EXTRACT(days FROM NOW() - i.snapshot_timestamp) > p.shelf_life_days * 0.8
        AND i.quantity_on_hand > 0
      ORDER BY days_until_expiry ASC
      LIMIT ${limit}
    `;

    const results = await QueryBuilder.executeWithDebug<ExpiryAlertRow[]>(
      app.prisma,
      query,
      [],
      'getExpiryAlerts'
    );

    return results.map((item, index) => {
      const daysUntilExpiry = item.days_until_expiry ?? 0;
      return {
        id: `expiry-${index}`,
        severity: daysUntilExpiry <= 0 ? 'critical' : 'warning',
        type: 'expiry_risk',
        message: `${item.product_name} (${item.sku}) expires in ${Math.round(daysUntilExpiry)} days`,
        product: item.sku,
        actionRequired: true,
        impact: item.value_at_risk ?? 0
      };
    });
  }

  static async getAllAlerts(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<DashboardAlert[]> {
    app.log.info('[ALERTS SERVICE] Fetching all alerts');
    
    const [stockoutAlerts, overstockAlerts, expiryAlerts] = await Promise.all([
      this.getStockoutAlerts(app, startDate, endDate),
      this.getOverstockAlerts(app, startDate, endDate),
      this.getExpiryAlerts(app)
    ]);

    const allAlerts = [...stockoutAlerts, ...overstockAlerts, ...expiryAlerts];
    
    // Sort by severity (critical first) and impact
    allAlerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const aSeverity = severityOrder[a.severity as keyof typeof severityOrder] ?? 3;
      const bSeverity = severityOrder[b.severity as keyof typeof severityOrder] ?? 3;
      
      if (aSeverity !== bSeverity) {
        return aSeverity - bSeverity;
      }
      
      return (b.impact || 0) - (a.impact || 0);
    });

    app.log.info(`[ALERTS SERVICE] Found ${allAlerts.length} total alerts`);
    return allAlerts.slice(0, 10); // Return top 10 alerts
  }
}