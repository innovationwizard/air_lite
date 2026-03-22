// api-node/src/routes/bi/dashboards/compras.dashboard.ts

import type { AppWithPrisma, Dashboard, DashboardOptions } from '../types';
import type {
  PurchaseMetrics,
  PurchaseTrend,
  SupplierPerformance,
  PendingPurchase,
  CostAnalysis,
  TopPurchasedProduct,
  PurchaseForecast,
  SupplierRisk,
  SavingsOpportunity
} from '../queries/purchases.queries';
import { PurchasesQueries } from '../queries/purchases.queries';
import { ForecastingQueries } from '../queries/forecasting.queries';
import type { PurchaseRecommendation } from '../types/kpi.types';

interface SparklineRow {
  date: string;
  value: string | number;
}

interface DashboardAlert {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  type: string;
  message: string;
  timestamp: string;
  action: string;
  details?: unknown[];
}

interface MaxDateRow {
  max_date: string | null;
}

export class ComprasDashboard {
  static async create(app: AppWithPrisma, options: DashboardOptions): Promise<Dashboard> {
    app.log.info({ options }, '[COMPRAS DASHBOARD] Creating Purchasing dashboard with options:');
    
    const { startDate, endDate } = options;
    const now = new Date();

    try {
      // Fetch all data in parallel
      const [
        purchaseMetrics,
        purchaseTrend,
        supplierPerformance,
        pendingPurchases,
        costAnalysis,
        topProducts,
        purchaseForecast,
        supplierRisks,
        savingsOpportunities,
        topRecommendation,
        maxDataDate
      ]: [
        PurchaseMetrics,
        PurchaseTrend[],
        SupplierPerformance[],
        PendingPurchase[],
        CostAnalysis[],
        TopPurchasedProduct[],
        PurchaseForecast[],
        SupplierRisk[],
        SavingsOpportunity[],
        PurchaseRecommendation | null,
        string | null
      ] = await Promise.all([
        PurchasesQueries.getPurchaseMetrics(app, startDate, endDate),
        PurchasesQueries.getPurchaseTrend(app, startDate, endDate),
        PurchasesQueries.getSupplierPerformance(app, startDate, endDate, 10),
        PurchasesQueries.getPendingPurchases(app, 20),
        PurchasesQueries.getCostAnalysis(app, startDate, endDate),
        PurchasesQueries.getTopPurchasedProducts(app, startDate, endDate, 10),
        PurchasesQueries.getPurchaseForecast(app, 30, 10),
        PurchasesQueries.getSupplierRiskAnalysis(app),
        PurchasesQueries.getSavingsOpportunities(app, 10),
        ForecastingQueries.getTopPurchaseRecommendation(app),
        this.getMaxDataDate(app)
      ]);

      app.log.info('[COMPRAS DASHBOARD] Data fetched successfully');
      app.log.info({ purchaseMetrics }, '[COMPRAS DASHBOARD] Purchase metrics:');

      return {
        role: 'Compras',
        title: 'Panel de Compras',
        lastUpdated: now.toISOString(),
        maxDataDate: maxDataDate || now.toISOString(),
        kpis: [
          {
            id: 'pending-approvals',
            name: 'Órdenes Pendientes',
            value: purchaseMetrics.pending_approvals,
            target: 10,
            unit: 'count',
            trend: this.calculateTrend(purchaseMetrics.pending_approvals, 10, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'pending_approvals', 7, startDate, endDate)
          },
          {
            id: 'total-spend',
            name: 'Gasto Total',
            value: purchaseMetrics.total_purchase_value,
            target: 200000,
            unit: 'currency',
            trend: this.calculateTrend(purchaseMetrics.total_purchase_value, 200000),
            sparkline: await this.getSparklineData(app, 'total_spend', 7, startDate, endDate)
          },
          {
            id: 'savings-ytd',
            name: 'Ahorros YTD',
            value: purchaseMetrics.total_savings,
            target: 50000,
            unit: 'currency',
            trend: this.calculateTrend(purchaseMetrics.total_savings, 50000),
            sparkline: await this.getSparklineData(app, 'savings', 7, startDate, endDate)
          },
          {
            id: 'orders-this-month',
            name: 'Órdenes del Período',
            value: purchaseMetrics.total_purchases,
            target: 50,
            unit: 'count',
            trend: this.calculateTrend(purchaseMetrics.total_purchases, 50),
            sparkline: await this.getSparklineData(app, 'orders', 7, startDate, endDate)
          },
          {
            id: 'avg-order-value',
            name: 'Valor Promedio',
            value: purchaseMetrics.avg_purchase_value,
            target: 5000,
            unit: 'currency',
            trend: this.calculateTrend(purchaseMetrics.avg_purchase_value, 5000),
            sparkline: await this.getSparklineData(app, 'avg_order', 7, startDate, endDate)
          },
          {
            id: 'on-time-delivery',
            name: 'Entregas a Tiempo',
            value: purchaseMetrics.on_time_delivery_rate,
            target: 95,
            unit: 'percentage',
            trend: this.calculateTrend(purchaseMetrics.on_time_delivery_rate, 95),
            sparkline: await this.getSparklineData(app, 'otd', 7, startDate, endDate)
          },
          {
            id: 'avg-lead-time',
            name: 'Lead Time Promedio',
            value: purchaseMetrics.avg_lead_time,
            target: 15,
            unit: 'days',
            trend: this.calculateTrend(purchaseMetrics.avg_lead_time, 15, true), // Lower is better
            sparkline: await this.getSparklineData(app, 'lead_time', 7, startDate, endDate)
          },
          {
            id: 'active-suppliers',
            name: 'Proveedores Activos',
            value: purchaseMetrics.unique_suppliers,
            target: 20,
            unit: 'count',
            trend: this.calculateTrend(purchaseMetrics.unique_suppliers, 20),
            sparkline: await this.getSparklineData(app, 'suppliers', 7, startDate, endDate)
          }
        ],
        alerts: this.generateAlerts(purchaseMetrics, supplierRisks, pendingPurchases, savingsOpportunities),
        aiHighlight: topRecommendation ? {
          id: topRecommendation.recommendation_id,
          type: 'purchase_recommendation',
          title: `Recomendación AI: ${topRecommendation.product_name}`,
          message: `Ordenar ${topRecommendation.recommended_quantity} unidades (${this.formatCurrency(topRecommendation.order_value ?? 0)})`,
          confidence: topRecommendation.confidence,
          details: {
            sku: topRecommendation.sku,
            currentStock: topRecommendation.current_stock,
            moq: topRecommendation.moq,
            orderValue: topRecommendation.order_value,
            reason: topRecommendation.reason
          }
        } : null,
        charts: {
          purchaseTrend: {
            type: 'line',
            data: purchaseTrend.map(pt => ({
              date: pt.date,
              value: pt.purchase_value,
              orders: pt.order_count,
              suppliers: pt.unique_suppliers
            })),
            config: {
              title: 'Tendencia de Compras',
              xAxis: 'date',
              yAxis: 'value',
              series: ['value', 'orders']
            }
          },
          costByCategory: {
            type: 'bar',
            data: costAnalysis.map(ca => ({
              category: ca.category,
              value: ca.total_cost,
              orders: ca.order_count,
              percentage: ca.percentage_of_total
            })),
            config: {
              title: 'Costos por Categoría',
              xAxis: 'category',
              yAxis: 'value'
            }
          },
          supplierPerformance: {
            type: 'table',
            data: supplierPerformance.map(sp => ({
              supplier: sp.supplier_name,
              onTimeDelivery: sp.on_time_delivery_rate,
              qualityScore: sp.quality_score,
              avgLeadTime: sp.avg_lead_time,
              totalOrders: sp.total_orders,
              totalValue: sp.total_value,
              rating: sp.rating
            })),
            config: {
              title: 'Desempeño de Proveedores'
            }
          },
          pendingOrders: {
            type: 'table',
            data: pendingPurchases.map(po => ({
              id: po.order_number,
              supplier: po.supplier_name,
              items: po.product_count,
              total: po.total_cost,
              dueDate: po.expected_delivery_date,
              urgency: po.urgency,
              status: po.status
            })),
            config: {
              title: 'Órdenes Pendientes'
            }
          },
          topProducts: {
            type: 'table',
            data: topProducts.map(tp => ({
              sku: tp.sku,
              product: tp.product_name,
              category: tp.category,
              quantity: tp.total_quantity,
              cost: tp.total_cost,
              avgCost: tp.avg_unit_cost,
              purchases: tp.purchase_count
            })),
            config: {
              title: 'Productos Más Comprados'
            }
          },
          purchaseForecast: {
            type: 'table',
            data: purchaseForecast.map(pf => ({
              sku: pf.sku,
              product: pf.product_name,
              category: pf.category,
              predictedDemand: pf.predicted_next_month,
              recommendedQty: pf.recommended_order_quantity,
              estimatedCost: pf.estimated_cost,
              confidence: pf.confidence
            })),
            config: {
              title: 'Pronóstico de Compras (Próximos 30 días)',
              description: 'Recomendaciones basadas en velocidad de ventas e inventario actual'
            }
          },
          savingsOpportunities: {
            type: 'table',
            data: savingsOpportunities.map(so => ({
              sku: so.sku,
              product: so.product_name,
              supplier: so.supplier_name,
              currentCost: so.recent_avg_cost,
              historicalCost: so.historical_avg_cost,
              increase: so.cost_increase_percentage,
              potentialSavings: so.potential_savings
            })),
            config: {
              title: 'Oportunidades de Ahorro',
              description: 'Productos con incrementos de precio significativos vs. promedio histórico'
            }
          },
          supplierRisks: {
            type: 'table',
            data: supplierRisks.filter(sr => sr.risk_level !== 'low_risk').map(sr => ({
              supplier: sr.supplier_name,
              riskLevel: sr.risk_level,
              lateDeliveries: sr.late_deliveries,
              totalOrders: sr.total_orders,
              avgLateDays: sr.avg_late_days,
              qualityScore: sr.avg_quality_score,
              lastOrder: sr.last_order_date
            })),
            config: {
              title: 'Análisis de Riesgo de Proveedores',
              description: 'Proveedores con problemas de desempeño'
            }
          }
        }
      };
    } catch (error) {
      app.log.error({ err: error }, '[COMPRAS DASHBOARD] Error creating dashboard:');
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

  private static async getSparklineData(
    app: AppWithPrisma, 
    metric: string, 
    days: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<number[]> {
    try {
      // Use actual date range if provided, otherwise last N days
      const dateCondition = startDate && endDate
        ? `WHERE purchase_datetime >= $1 AND purchase_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
        : `WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '${days} days' AND is_deleted = false`;

      const metricMap: { [key: string]: string } = {
        'pending_approvals': "COUNT(*) FILTER (WHERE status = 'pending_approval')",
        'total_spend': 'SUM(total_cost)',
        'savings': 'SUM(discount_amount)',
        'orders': 'COUNT(*)',
        'avg_order': 'AVG(total_cost)',
        'otd': "(COUNT(*) FILTER (WHERE on_time_delivery = true)::FLOAT / NULLIF(COUNT(*) FILTER (WHERE actual_delivery_date IS NOT NULL), 0)::FLOAT * 100)",
        'lead_time': 'AVG(lead_time_days) FILTER (WHERE lead_time_days IS NOT NULL)',
        'suppliers': 'COUNT(DISTINCT supplier_id)'
      };

      const aggregation = metricMap[metric] || 'COUNT(*)';

      const query = `
        SELECT 
          DATE(purchase_datetime) as date,
          ${aggregation} as value
        FROM purchases
        ${dateCondition}
        GROUP BY DATE(purchase_datetime)
        ORDER BY date
      `;

      const params = startDate && endDate ? [startDate, endDate] : [];
      const result = await app.prisma.$queryRawUnsafe<SparklineRow[]>(query, ...params);
      
      // If we have data, return it
      if (result && result.length > 0) {
        return result.map(r => Number(r.value) || 0);
      }

      // If no data, return flat line at 0
      return Array<number>(days).fill(0);
    } catch (error) {
      app.log.error({ err: error }, `[COMPRAS DASHBOARD] Error getting sparkline data for ${metric}:`);
      return Array<number>(days).fill(0);
    }
  }

  private static generateAlerts(
    metrics: PurchaseMetrics,
    supplierRisks: SupplierRisk[],
    pendingOrders: PendingPurchase[],
    savingsOpportunities: SavingsOpportunity[]
  ): DashboardAlert[] {
    const alerts: DashboardAlert[] = [];
    const now = new Date();

    // Critical: High number of pending approvals
    if (metrics.pending_approvals > 10) {
      alerts.push({
        id: `alert-pending-${Date.now()}`,
        severity: 'high',
        type: 'purchase_approval',
        message: `${metrics.pending_approvals} órdenes de compra esperando aprobación`,
        timestamp: now.toISOString(),
        action: 'review_pending_orders'
      });
    }

    // Critical: Low on-time delivery rate
    if (metrics.on_time_delivery_rate < 85) {
      alerts.push({
        id: `alert-otd-${Date.now()}`,
        severity: 'high',
        type: 'delivery_performance',
        message: `Tasa de entrega a tiempo baja: ${metrics.on_time_delivery_rate.toFixed(1)}% (objetivo: 95%)`,
        timestamp: now.toISOString(),
        action: 'review_supplier_performance'
      });
    }

    // Warning: Long lead times
    if (metrics.avg_lead_time > 20) {
      alerts.push({
        id: `alert-leadtime-${Date.now()}`,
        severity: 'medium',
        type: 'lead_time',
        message: `Lead time promedio alto: ${metrics.avg_lead_time.toFixed(1)} días (objetivo: 15 días)`,
        timestamp: now.toISOString(),
        action: 'optimize_lead_times'
      });
    }

    // Critical: Urgent pending orders (within 3 days)
    const urgentOrders = pendingOrders.filter(po => po.urgency === 'high');
    if (urgentOrders.length > 0) {
      alerts.push({
        id: `alert-urgent-${Date.now()}`,
        severity: 'high',
        type: 'urgent_delivery',
        message: `${urgentOrders.length} órdenes con entrega urgente (≤3 días)`,
        timestamp: now.toISOString(),
        action: 'expedite_orders',
        details: urgentOrders.slice(0, 3).map(o => o.order_number)
      });
    }

    // Info: High-risk suppliers detected
    const highRiskSuppliers = supplierRisks.filter(sr => sr.risk_level === 'high_risk');
    if (highRiskSuppliers.length > 0) {
      alerts.push({
        id: `alert-supplier-risk-${Date.now()}`,
        severity: 'medium',
        type: 'supplier_risk',
        message: `${highRiskSuppliers.length} proveedores de alto riesgo identificados`,
        timestamp: now.toISOString(),
        action: 'review_supplier_contracts',
        details: highRiskSuppliers.slice(0, 3).map(s => s.supplier_name)
      });
    }

    // Info: Significant savings opportunities
    if (savingsOpportunities.length > 0 && savingsOpportunities[0].potential_savings > 1000) {
      const totalPotentialSavings = savingsOpportunities.reduce((sum, so) => sum + so.potential_savings, 0);
      alerts.push({
        id: `alert-savings-${Date.now()}`,
        severity: 'info',
        type: 'cost_optimization',
        message: `Oportunidad de ahorro potencial: ${this.formatCurrency(totalPotentialSavings)}`,
        timestamp: now.toISOString(),
        action: 'review_pricing',
        details: savingsOpportunities.slice(0, 3).map(so => ({
          product: so.sku,
          savings: so.potential_savings
        }))
      });
    }

    return alerts;
  }

  private static async getMaxDataDate(app: AppWithPrisma): Promise<string | null> {
    try {
      const query = `
        SELECT MAX(purchase_datetime) as max_date
        FROM purchases
        WHERE is_deleted = false
      `;
      const result = await app.prisma.$queryRawUnsafe<MaxDateRow[]>(query);
      return result[0]?.max_date || null;
    } catch (error) {
      app.log.error({ err: error }, '[COMPRAS DASHBOARD] Error getting max data date:');
      return null;
    }
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