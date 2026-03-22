// api-node/src/routes/bi/dashboards/inventario.dashboard.ts

import type { AppWithPrisma, Dashboard, DashboardOptions, DashboardAlert } from '../types';
import {
  InventoryQueries,
  InventoryMetrics,
  WarehouseMetrics,
  InventoryByZone,
  InventoryByCategory,
  InventoryMovement,
  CycleCountDiscrepancy,
  StockAlert,
  SlowMovingItem
} from '../queries/inventory.queries';
import { QueryBuilder } from '../utils/query-builder';

interface MaxDateRow {
  max_date: string | null;
}

export class InventarioDashboard {
  static async create(app: AppWithPrisma, options: DashboardOptions): Promise<Dashboard> {
    app.log.info({ options }, '[INVENTARIO DASHBOARD] Creating Inventory dashboard with options:');
    
    const { startDate, endDate } = options;
    const now = new Date();

    try {
      // Fetch all data in parallel with comprehensive error handling
      const inventoryMetrics = await InventoryQueries.getInventoryMetrics(app, startDate, endDate).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting inventory metrics:');
        return this.getDefaultInventoryMetrics();
      });

      const warehouseMetrics = await InventoryQueries.getWarehouseMetrics(app, startDate, endDate).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting warehouse metrics:');
        return this.getDefaultWarehouseMetrics();
      });

      const inventoryByZone = await InventoryQueries.getInventoryByZone(app).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting inventory by zone:');
        return [] as InventoryByZone[];
      });

      const inventoryByCategory = await InventoryQueries.getInventoryByCategory(app, startDate, endDate).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting inventory by category:');
        return [] as InventoryByCategory[];
      });

      const recentMovements = await InventoryQueries.getInventoryMovements(app, startDate, endDate, 50).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting movements:');
        return [] as InventoryMovement[];
      });

      const cycleCountDiscrepancies = await InventoryQueries.getCycleCountDiscrepancies(app, 20).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting discrepancies:');
        return [] as CycleCountDiscrepancy[];
      });

      const stockAlerts = await InventoryQueries.getStockAlerts(app, 20).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting stock alerts:');
        return [] as StockAlert[];
      });

      const slowMovingItems = await InventoryQueries.getSlowMovingItems(app, 20).catch(err => {
        app.log.error({ err: err }, '[INVENTARIO DASHBOARD] Error getting slow moving items:');
        return [] as SlowMovingItem[];
      });

      const maxDataDate = await this.getMaxDataDate(app);

      app.log.info('[INVENTARIO DASHBOARD] Data fetched successfully');
      app.log.info({ inventoryMetrics }, '[INVENTARIO DASHBOARD] Inventory metrics:');

      return {
        role: 'Inventario',
        title: 'Panel de Inventario',
        lastUpdated: now.toISOString(),
        maxDataDate: maxDataDate || now.toISOString(),
        kpis: [
          {
            id: 'total-skus',
            name: 'Total SKUs',
            value: inventoryMetrics.total_skus,
            target: 500,
            unit: 'count',
            trend: this.calculateTrend(inventoryMetrics.total_skus, 500),
            sparkline: await this.getSparklineData(app, 'total_skus', 7)
          },
          {
            id: 'inventory-value',
            name: 'Valor Total Inventario',
            value: inventoryMetrics.total_value,
            target: 300000,
            unit: 'currency',
            trend: this.calculateTrend(inventoryMetrics.total_value, 300000),
            sparkline: await this.getSparklineData(app, 'inventory_value', 7)
          },
          {
            id: 'inventory-accuracy',
            name: 'Precisión de Inventario',
            value: inventoryMetrics.accuracy,
            target: 95,
            unit: 'percentage',
            trend: this.calculateTrend(inventoryMetrics.accuracy, 95),
            sparkline: await this.getSparklineData(app, 'accuracy', 7)
          },
          {
            id: 'turnover-rate',
            name: 'Rotación de Inventario',
            value: inventoryMetrics.turnover_rate,
            target: 6,
            unit: 'ratio',
            trend: this.calculateTrend(inventoryMetrics.turnover_rate, 6),
            sparkline: await this.getSparklineData(app, 'turnover', 7)
          },
          {
            id: 'stockout-rate',
            name: 'Tasa de Stockouts',
            value: inventoryMetrics.stockout_rate,
            target: 5,
            unit: 'percentage',
            trend: this.calculateTrend(inventoryMetrics.stockout_rate, 5, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'stockout_rate', 7)
          },
          {
            id: 'overstock-rate',
            name: 'Tasa de Sobrestock',
            value: inventoryMetrics.overstock_rate,
            target: 10,
            unit: 'percentage',
            trend: this.calculateTrend(inventoryMetrics.overstock_rate, 10, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'overstock_rate', 7)
          },
          {
            id: 'fill-rate',
            name: 'Tasa de Cumplimiento',
            value: inventoryMetrics.fill_rate,
            target: 95,
            unit: 'percentage',
            trend: this.calculateTrend(inventoryMetrics.fill_rate, 95),
            sparkline: await this.getSparklineData(app, 'fill_rate', 7)
          },
          {
            id: 'days-on-hand',
            name: 'Días de Inventario',
            value: inventoryMetrics.days_on_hand,
            target: 30,
            unit: 'days',
            trend: this.calculateTrend(inventoryMetrics.days_on_hand, 30, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'days_on_hand', 7)
          },
          {
            id: 'receiving-efficiency',
            name: 'Eficiencia de Recepción',
            value: warehouseMetrics.receiving_efficiency,
            target: 90,
            unit: 'percentage',
            trend: this.calculateTrend(warehouseMetrics.receiving_efficiency, 90),
            sparkline: await this.getSparklineData(app, 'receiving_eff', 7)
          },
          {
            id: 'picking-accuracy',
            name: 'Precisión de Picking',
            value: warehouseMetrics.picking_accuracy,
            target: 98,
            unit: 'percentage',
            trend: this.calculateTrend(warehouseMetrics.picking_accuracy, 98),
            sparkline: await this.getSparklineData(app, 'picking_acc', 7)
          },
          {
            id: 'cycle-count-accuracy',
            name: 'Precisión Conteo Cíclico',
            value: warehouseMetrics.cycle_count_accuracy,
            target: 95,
            unit: 'percentage',
            trend: this.calculateTrend(warehouseMetrics.cycle_count_accuracy, 95),
            sparkline: await this.getSparklineData(app, 'cycle_count_acc', 7)
          },
          {
            id: 'backorder-rate',
            name: 'Tasa de Órdenes Pendientes',
            value: warehouseMetrics.backorder_rate,
            target: 5,
            unit: 'percentage',
            trend: this.calculateTrend(warehouseMetrics.backorder_rate, 5, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'backorder_rate', 7)
          }
        ],
        alerts: this.generateAlerts(inventoryMetrics, stockAlerts, cycleCountDiscrepancies, slowMovingItems),
        charts: {
          inventoryByZone: {
            type: 'bar',
            data: inventoryByZone.map(z => ({
              zone: z.zone,
              total_units: z.total_units,
              available_units: z.available_units,
              damaged_units: z.damaged_units,
              quarantine_units: z.quarantine_units,
              value: z.total_value,
              sku_count: z.sku_count
            })),
            config: {
              title: 'Inventario por Zona',
              xAxis: 'zone',
              yAxis: 'value'
            }
          },
          inventoryByCategory: {
            type: 'table',
            data: inventoryByCategory.map(c => ({
              category: c.category,
              items: c.items,
              quantity: c.quantity_on_hand,
              value: c.value,
              turnover: c.turnover,
              stockout_risk: c.stockout_risk,
              days_on_hand: c.avg_days_on_hand
            })),
            config: {
              title: 'Inventario por Categoría'
            }
          },
          recentMovements: {
            type: 'table',
            data: recentMovements.map(m => ({
              date: m.date,
              product: m.product_name,
              sku: m.sku,
              type: m.movement_type,
              quantity: m.quantity,
              from_location: m.from_location,
              to_location: m.to_location,
              value: m.value,
              user: m.user,
              reason: m.reason
            })),
            config: {
              title: 'Movimientos Recientes'
            }
          },
          cycleCountDiscrepancies: {
            type: 'table',
            data: cycleCountDiscrepancies.map(d => ({
              sku: d.sku,
              product: d.product,
              zone: d.zone,
              bin_location: d.bin_location,
              system_qty: d.system_qty,
              counted_qty: d.counted_qty,
              variance: d.variance,
              variance_value: d.variance_value,
              count_date: d.count_date,
              status: d.status,
              counted_by: d.counted_by
            })),
            config: {
              title: 'Discrepancias de Conteo Cíclico'
            }
          },
          stockAlerts: {
            type: 'table',
            data: stockAlerts.map(a => ({
              type: a.type,
              sku: a.sku,
              product_name: a.product_name,
              current_stock: a.current_stock,
              min_quantity: a.min_quantity,
              reorder_point: a.reorder_point,
              days_of_stock: a.days_of_stock,
              expiry_date: a.expiry_date
            })),
            config: {
              title: 'Alertas de Stock'
            }
          },
          slowMovingItems: {
            type: 'table',
            data: slowMovingItems.map(s => ({
              sku: s.sku,
              product_name: s.product_name,
              quantity_on_hand: s.quantity_on_hand,
              value: s.value,
              days_since_movement: s.days_since_movement,
              last_movement_date: s.last_movement_date,
              location_zone: s.location_zone
            })),
            config: {
              title: 'Productos de Baja Rotación',
              description: 'Sin movimiento en 90+ días'
            }
          },
          inventoryValue: {
            type: 'pie',
            data: [
              { name: 'Disponible', value: inventoryMetrics.available_value },
              { name: 'Dañado', value: inventoryMetrics.damaged_value },
              { name: 'Cuarentena', value: inventoryMetrics.quarantine_value }
            ],
            config: {
              title: 'Distribución de Valor por Estado'
            }
          }
        }
      };
    } catch (error) {
      app.log.error({ err: error }, '[INVENTARIO DASHBOARD] Error creating dashboard:');
      throw error;
    }
  }

  private static calculateTrend(current: number, target: number, lowerIsBetter: boolean = false): 'up' | 'down' | 'stable' {
    if (lowerIsBetter) {
      if (current <= target) return 'up'; // Good: value is low
      if (current <= target * 1.2) return 'stable';
      return 'down'; // Bad: value is high
    } else {
      if (current >= target) return 'up'; // Good: value is high
      if (current >= target * 0.8) return 'stable';
      return 'down'; // Bad: value is low
    }
  }

  private static getSparklineData(
    app: AppWithPrisma, 
    metric: string, 
    days: number
  ): Promise<number[]> {
    app.log.warn(`[INVENTARIO DASHBOARD] Historical snapshots not available for metric: ${metric}`);
    return Promise.resolve(Array<number>(days).fill(0));
  }

  private static generateAlerts(
    metrics: InventoryMetrics,
    stockAlerts: StockAlert[],
    discrepancies: CycleCountDiscrepancy[],
    slowMoving: SlowMovingItem[]
  ): DashboardAlert[] {
    const alerts: DashboardAlert[] = [];
    const now = new Date();

    // Critical: High stockout rate
    if (metrics.stockout_rate > 10) {
      alerts.push({
        id: `alert-stockout-${Date.now()}`,
        severity: 'high',
        type: 'stockout',
        message: `Tasa de stockouts alta: ${metrics.stockout_rate.toFixed(1)}% (objetivo: <5%)`,
        timestamp: now.toISOString(),
        action: 'review_reorder_points'
      });
    }

    // Critical: Low inventory accuracy
    if (metrics.accuracy < 90) {
      alerts.push({
        id: `alert-accuracy-${Date.now()}`,
        severity: 'high',
        type: 'accuracy',
        message: `Precisión de inventario baja: ${metrics.accuracy.toFixed(1)}% (objetivo: 95%)`,
        timestamp: now.toISOString(),
        action: 'increase_cycle_counts'
      });
    }

    // Warning: Overstock situation
    if (metrics.overstock_rate > 15) {
      alerts.push({
        id: `alert-overstock-${Date.now()}`,
        severity: 'medium',
        type: 'overstock',
        message: `Tasa de sobrestock: ${metrics.overstock_rate.toFixed(1)}% (objetivo: <10%)`,
        timestamp: now.toISOString(),
        action: 'review_max_quantities'
      });
    }

    // Critical: Pending discrepancies
    if (discrepancies.length > 10) {
      alerts.push({
        id: `alert-discrepancies-${Date.now()}`,
        severity: 'high',
        type: 'discrepancies',
        message: `${discrepancies.length} discrepancias pendientes de resolución`,
        timestamp: now.toISOString(),
        action: 'resolve_discrepancies'
      });
    }

    // Info: Stock alerts
    const criticalAlerts = stockAlerts.filter(a => a.type === 'stockout' || a.type === 'low_stock');
    if (criticalAlerts.length > 0) {
      alerts.push({
        id: `alert-stock-${Date.now()}`,
        severity: 'medium',
        type: 'stock_alert',
        message: `${criticalAlerts.length} productos requieren reabastecimiento inmediato`,
        timestamp: now.toISOString(),
        action: 'create_purchase_orders',
        details: criticalAlerts.slice(0, 5).map(a => a.sku)
      });
    }

    // Info: Slow moving items
    if (slowMoving.length > 0) {
      const totalValue = slowMoving.reduce((sum, item) => sum + item.value, 0);
      alerts.push({
        id: `alert-slow-moving-${Date.now()}`,
        severity: 'info',
        type: 'slow_moving',
        message: `${slowMoving.length} productos sin movimiento (${this.formatCurrency(totalValue)} inmovilizado)`,
        timestamp: now.toISOString(),
        action: 'review_slow_movers',
        details: slowMoving.slice(0, 5).map(s => s.sku)
      });
    }

    return alerts;
  }

  private static async getMaxDataDate(app: AppWithPrisma): Promise<string | null> {
    try {
      const query = `
        SELECT MAX(snapshot_timestamp) as max_date
        FROM inventory_snapshots
        WHERE is_deleted = false
      `;
      const result = await QueryBuilder.executeWithDebug<MaxDateRow[]>(
        app.prisma,
        query,
        [],
        'InventarioDashboard.getMaxDataDate'
      );
      return result[0]?.max_date || null;
    } catch (error) {
      app.log.error({ err: error }, '[INVENTARIO DASHBOARD] Error getting max data date:');
      return null;
    }
  }

  private static getDefaultInventoryMetrics(): InventoryMetrics {
    return {
      total_skus: 0,
      total_value: 0,
      available_value: 0,
      damaged_value: 0,
      quarantine_value: 0,
      accuracy: 95,
      fill_rate: 100,
      turnover_rate: 0,
      stockout_rate: 0,
      overstock_rate: 0,
      days_on_hand: 0
    };
  }

  private static getDefaultWarehouseMetrics(): WarehouseMetrics {
    return {
      receiving_efficiency: 90,
      picking_accuracy: 98,
      cycle_count_accuracy: 95,
      backorder_rate: 0,
      shrinkage_rate: 0
    };
  }

  private static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-GT', {
      style: 'currency',
      currency: 'GTQ',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  }
}