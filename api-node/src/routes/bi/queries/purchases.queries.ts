// api-node/src/routes/bi/queries/purchases.queries.ts

import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

export interface PurchaseMetrics {
  total_purchases: number;
  total_purchase_value: number;
  avg_purchase_value: number;
  unique_suppliers: number;
  unique_products_purchased: number;
  pending_approvals: number;
  on_time_delivery_rate: number;
  avg_lead_time: number;
  total_savings: number;
}

export interface PurchaseTrend {
  date: string;
  purchase_value: number;
  order_count: number;
  unique_suppliers: number;
  avg_unit_cost: number;
}

export interface SupplierPerformance {
  supplier_id: number;
  supplier_name: string;
  total_orders: number;
  total_value: number;
  avg_order_value: number;
  on_time_delivery_rate: number;
  avg_lead_time: number;
  quality_score: number;
  last_purchase_date: string;
  rating: number;
}

export interface PendingPurchase {
  purchase_id: number;
  order_number: string;
  supplier_name: string;
  product_count: number;
  total_cost: number;
  expected_delivery_date: string;
  days_until_delivery: number;
  status: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface CostAnalysis {
  category: string;
  total_cost: number;
  order_count: number;
  avg_cost_per_order: number;
  percentage_of_total: number;
}

export interface PurchaseForecast {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  avg_monthly_purchase: number;
  predicted_next_month: number;
  recommended_order_quantity: number;
  estimated_cost: number;
  confidence: number;
}

export interface TopPurchasedProduct {
  sku: string;
  product_name: string;
  category: string;
  purchase_count: number;
  total_quantity: number;
  total_cost: number;
  avg_unit_cost: number;
  last_purchase_date: string;
}

export interface SupplierRisk {
  supplier_id: number;
  supplier_name: string;
  rating: number;
  total_orders: number;
  late_deliveries: number;
  avg_late_days: number;
  avg_quality_score: number;
  last_order_date: string;
  days_since_last_order: number;
  risk_level: 'inactive' | 'low_risk' | 'medium_risk' | 'high_risk';
}

export interface SavingsOpportunity {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  supplier_name: string;
  recent_avg_cost: number;
  historical_avg_cost: number;
  recent_quantity: number;
  cost_increase_percentage: number;
  potential_savings: number;
}

interface PurchaseMetricsRow {
  total_purchases: number | null;
  total_purchase_value: number | null;
  avg_purchase_value: number | null;
  unique_suppliers: number | null;
  unique_products_purchased: number | null;
  pending_approvals: number | null;
  on_time_delivery_rate: number | null;
  avg_lead_time: number | null;
  total_savings: number | null;
}

type PurchaseTrendRow = PurchaseTrend;

type PendingPurchaseRow = PendingPurchase;

type SupplierPerformanceRow = SupplierPerformance;

type CostAnalysisRow = CostAnalysis;

type TopPurchasedProductRow = TopPurchasedProduct;

type PurchaseForecastRow = PurchaseForecast;

type SupplierRiskRow = SupplierRisk;

type SavingsOpportunityRow = SavingsOpportunity;

export class PurchasesQueries {
  
  /**
   * Get comprehensive purchase metrics for the dashboard
   */
  static async getPurchaseMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<PurchaseMetrics> {
    app.log.info(`[PURCHASES QUERIES] getPurchaseMetrics called with dates: ${startDate?.toISOString()} to ${endDate?.toISOString()}`);
    
    const dateCondition = startDate && endDate
      ? `WHERE p.purchase_datetime >= $1 AND p.purchase_datetime < $2 + INTERVAL '1 day' AND p.is_deleted = false`
      : `WHERE p.purchase_datetime >= (SELECT MAX(purchase_datetime) - INTERVAL '30 days' FROM purchases WHERE is_deleted = false)
         AND p.purchase_datetime <= (SELECT MAX(purchase_datetime) FROM purchases WHERE is_deleted = false)
         AND p.is_deleted = false`;

    const query = `
      WITH purchase_stats AS (
        SELECT 
          COUNT(*) as total_purchases,
          SUM(p.total_cost) as total_purchase_value,
          AVG(p.total_cost) as avg_purchase_value,
          COUNT(DISTINCT p.supplier_id) as unique_suppliers,
          COUNT(DISTINCT p.product_id) as unique_products_purchased,
          COUNT(*) FILTER (WHERE p.status = 'pending_approval') as pending_approvals,
          COUNT(*) FILTER (WHERE p.on_time_delivery = true) as on_time_deliveries,
          COUNT(*) FILTER (WHERE p.actual_delivery_date IS NOT NULL) as completed_deliveries,
          AVG(p.lead_time_days) FILTER (WHERE p.lead_time_days IS NOT NULL) as avg_lead_time,
          SUM(p.discount_amount) as total_savings
        FROM purchases p
        ${dateCondition}
      )
      SELECT 
        total_purchases,
        total_purchase_value,
        avg_purchase_value,
        unique_suppliers,
        unique_products_purchased,
        pending_approvals,
        CASE 
          WHEN completed_deliveries > 0 
          THEN (on_time_deliveries::FLOAT / completed_deliveries::FLOAT * 100)
          ELSE 0 
        END as on_time_delivery_rate,
        COALESCE(avg_lead_time, 0) as avg_lead_time,
        COALESCE(total_savings, 0) as total_savings
      FROM purchase_stats
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<PurchaseMetricsRow[]>(
      app.prisma,
      query,
      params,
      'PurchasesQueries.getPurchaseMetrics'
    );

    const row = result[0] || {};
    const metrics = {
      total_purchases: Number(row.total_purchases) || 0,
      total_purchase_value: Number(row.total_purchase_value) || 0,
      avg_purchase_value: Number(row.avg_purchase_value) || 0,
      unique_suppliers: Number(row.unique_suppliers) || 0,
      unique_products_purchased: Number(row.unique_products_purchased) || 0,
      pending_approvals: Number(row.pending_approvals) || 0,
      on_time_delivery_rate: Number(row.on_time_delivery_rate) || 0,
      avg_lead_time: Number(row.avg_lead_time) || 0,
      total_savings: Number(row.total_savings) || 0
    };

    app.log.info({ metrics }, `[PURCHASES QUERIES] Returning metrics:`);
    return metrics;
  }

  /**
   * Get purchase trend over time
   */
  static async getPurchaseTrend(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<PurchaseTrend[]> {
    const dateCondition = startDate && endDate
      ? `WHERE purchase_datetime >= $1 AND purchase_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '30 days' AND is_deleted = false`;

    const query = `
      SELECT 
        DATE(purchase_datetime) as date,
        SUM(total_cost) as purchase_value,
        COUNT(*) as order_count,
        COUNT(DISTINCT supplier_id) as unique_suppliers,
        AVG(unit_cost) as avg_unit_cost
      FROM purchases
      ${dateCondition}
      GROUP BY DATE(purchase_datetime)
      ORDER BY date
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result: PurchaseTrendRow[] = await QueryBuilder.executeWithDebug<PurchaseTrendRow[]>(
      app.prisma,
      query,
      params,
      'PurchasesQueries.getPurchaseTrend'
    );

    return result.map(({ date, purchase_value, order_count, unique_suppliers, avg_unit_cost }: PurchaseTrendRow) => ({
      date,
      purchase_value: Number(purchase_value) || 0,
      order_count: Number(order_count) || 0,
      unique_suppliers: Number(unique_suppliers) || 0,
      avg_unit_cost: Number(avg_unit_cost) || 0
    }));
  }

  /**
   * Get detailed supplier performance metrics
   */
  static async getSupplierPerformance(app: AppWithPrisma, startDate?: Date, endDate?: Date, limit: number = 20): Promise<SupplierPerformance[]> {
    const dateCondition = startDate && endDate
      ? `WHERE p.purchase_datetime >= $1 AND p.purchase_datetime < $2 + INTERVAL '1 day' AND p.is_deleted = false`
      : `WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '90 days' AND p.is_deleted = false`;

    const query = `
      SELECT 
        s.supplier_id,
        s.supplier_name,
        COUNT(*) as total_orders,
        SUM(p.total_cost) as total_value,
        AVG(p.total_cost) as avg_order_value,
        (COUNT(*) FILTER (WHERE p.on_time_delivery = true)::FLOAT / 
         NULLIF(COUNT(*) FILTER (WHERE p.actual_delivery_date IS NOT NULL), 0)::FLOAT * 100) as on_time_delivery_rate,
        AVG(p.lead_time_days) FILTER (WHERE p.lead_time_days IS NOT NULL) as avg_lead_time,
        AVG(p.quality_score) FILTER (WHERE p.quality_score IS NOT NULL) as quality_score,
        MAX(p.purchase_datetime) as last_purchase_date,
        s.rating
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.supplier_id
      ${dateCondition}
      GROUP BY s.supplier_id, s.supplier_name, s.rating
      ORDER BY total_value DESC
      LIMIT $${startDate && endDate ? 3 : 1}
    `;

    const params = startDate && endDate ? [startDate, endDate, limit] : [limit];

    const result: SupplierPerformanceRow[] = await QueryBuilder.executeWithDebug<SupplierPerformanceRow[]>(
      app.prisma,
      query,
      params,
      'PurchasesQueries.getSupplierPerformance'
    );

    return result.map(({
      supplier_id,
      supplier_name,
      total_orders,
      total_value,
      avg_order_value,
      on_time_delivery_rate,
      avg_lead_time,
      quality_score,
      last_purchase_date,
      rating
    }: SupplierPerformanceRow) => ({
      supplier_id: Number(supplier_id),
      supplier_name,
      total_orders: Number(total_orders) || 0,
      total_value: Number(total_value) || 0,
      avg_order_value: Number(avg_order_value) || 0,
      on_time_delivery_rate: Number(on_time_delivery_rate) || 0,
      avg_lead_time: Number(avg_lead_time) || 0,
      quality_score: Number(quality_score) || 0,
      last_purchase_date,
      rating: Number(rating) || 0
    }));
  }

  /**
   * Get pending purchase orders that need attention
   */
  static async getPendingPurchases(app: AppWithPrisma, limit: number = 10): Promise<PendingPurchase[]> {
    const query = `
      SELECT 
        p.purchase_id,
        p.order_number,
        s.supplier_name,
        COUNT(DISTINCT p.product_id) as product_count,
        SUM(p.total_cost) as total_cost,
        p.expected_delivery_date,
        EXTRACT(DAY FROM (p.expected_delivery_date - CURRENT_DATE)) as days_until_delivery,
        p.status,
        CASE 
          WHEN EXTRACT(DAY FROM (p.expected_delivery_date - CURRENT_DATE)) <= 3 THEN 'high'
          WHEN EXTRACT(DAY FROM (p.expected_delivery_date - CURRENT_DATE)) <= 7 THEN 'medium'
          ELSE 'low'
        END as urgency
      FROM purchases p
      JOIN suppliers s ON p.supplier_id = s.supplier_id
      WHERE p.status IN ('pending_approval', 'approved', 'ordered', 'in_transit')
        AND p.is_deleted = false
      GROUP BY p.purchase_id, p.order_number, s.supplier_name, p.expected_delivery_date, p.status
      ORDER BY 
        CASE 
          WHEN p.status = 'pending_approval' THEN 1
          WHEN p.status = 'in_transit' THEN 2
          WHEN p.status = 'ordered' THEN 3
          ELSE 4
        END,
        p.expected_delivery_date
      LIMIT $1
    `;

    const result: PendingPurchaseRow[] = await QueryBuilder.executeWithDebug<PendingPurchaseRow[]>(
      app.prisma,
      query,
      [limit],
      'PurchasesQueries.getPendingPurchases'
    );

    return result.map(({
      purchase_id,
      order_number,
      supplier_name,
      product_count,
      total_cost,
      expected_delivery_date,
      days_until_delivery,
      status,
      urgency
    }: PendingPurchaseRow) => ({
      purchase_id: Number(purchase_id),
      order_number: order_number || `PO-${purchase_id}`,
      supplier_name,
      product_count: Number(product_count) || 1,
      total_cost: Number(total_cost) || 0,
      expected_delivery_date,
      days_until_delivery: Number(days_until_delivery) || 0,
      status,
      urgency
    }));
  }

  /**
   * Get cost analysis by product category
   */
  static async getCostAnalysis(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CostAnalysis[]> {
    const dateCondition = startDate && endDate
      ? `WHERE p.purchase_datetime >= $1 AND p.purchase_datetime < $2 + INTERVAL '1 day' AND p.is_deleted = false`
      : `WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '30 days' AND p.is_deleted = false`;

    const query = `
      WITH category_costs AS (
        SELECT 
          pr.category,
          SUM(p.total_cost) as total_cost,
          COUNT(*) as order_count,
          AVG(p.total_cost) as avg_cost_per_order
        FROM purchases p
        JOIN products pr ON p.product_id = pr.product_id
        ${dateCondition}
        GROUP BY pr.category
      ),
      total_spend AS (
        SELECT SUM(total_cost) as overall_total
        FROM category_costs
      )
      SELECT 
        cc.category,
        cc.total_cost,
        cc.order_count,
        cc.avg_cost_per_order,
        (cc.total_cost / NULLIF(ts.overall_total, 0) * 100) as percentage_of_total
      FROM category_costs cc
      CROSS JOIN total_spend ts
      ORDER BY cc.total_cost DESC
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<CostAnalysisRow[]>(
      app.prisma,
      query,
      params,
      'PurchasesQueries.getCostAnalysis'
    );

    return result.map(({
      category,
      total_cost,
      order_count,
      avg_cost_per_order,
      percentage_of_total
    }: CostAnalysisRow) => ({
      category,
      total_cost: Number(total_cost) || 0,
      order_count: Number(order_count) || 0,
      avg_cost_per_order: Number(avg_cost_per_order) || 0,
      percentage_of_total: Number(percentage_of_total) || 0
    }));
  }

  /**
   * Get top purchased products
   */
  static async getTopPurchasedProducts(app: AppWithPrisma, startDate?: Date, endDate?: Date, limit: number = 10): Promise<TopPurchasedProduct[]> {
    const dateCondition = startDate && endDate
      ? `WHERE p.purchase_datetime >= $1 AND p.purchase_datetime < $2 + INTERVAL '1 day' AND p.is_deleted = false`
      : `WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '30 days' AND p.is_deleted = false`;

    const query = `
      SELECT 
        pr.sku,
        pr.product_name,
        pr.category,
        COUNT(*) as purchase_count,
        SUM(p.quantity) as total_quantity,
        SUM(p.total_cost) as total_cost,
        AVG(p.unit_cost) as avg_unit_cost,
        MAX(p.purchase_datetime) as last_purchase_date
      FROM purchases p
      JOIN products pr ON p.product_id = pr.product_id
      ${dateCondition}
      GROUP BY pr.sku, pr.product_name, pr.category
      ORDER BY total_cost DESC
      LIMIT $${startDate && endDate ? 3 : 1}
    `;

    const params = startDate && endDate ? [startDate, endDate, limit] : [limit];

    const result: TopPurchasedProductRow[] = await QueryBuilder.executeWithDebug<TopPurchasedProductRow[]>(
      app.prisma,
      query,
      params,
      'PurchasesQueries.getTopPurchasedProducts'
    );

    return result.map(({
      sku,
      product_name,
      category,
      purchase_count,
      total_quantity,
      total_cost,
      avg_unit_cost,
      last_purchase_date
    }: TopPurchasedProductRow) => ({
      sku,
      product_name,
      category,
      purchase_count: Number(purchase_count) || 0,
      total_quantity: Number(total_quantity) || 0,
      total_cost: Number(total_cost) || 0,
      avg_unit_cost: Number(avg_unit_cost) || 0,
      last_purchase_date
    }));
  }

  /**
   * Predict future purchase needs based on sales velocity and inventory levels
   * This is cutting-edge forecasting for the purchasing team
   */
  static async getPurchaseForecast(app: AppWithPrisma, daysAhead: number = 30, limit: number = 20): Promise<PurchaseForecast[]> {
    const query = `
      WITH sales_velocity AS (
        SELECT 
          product_id,
          COUNT(*) as sale_frequency,
          SUM(quantity * uom_ratio) as total_sold,
          AVG(quantity * uom_ratio) as avg_sale_quantity,
          SUM(quantity * uom_ratio) / 30.0 as daily_velocity
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
          AND is_deleted = false
        GROUP BY product_id
      ),
      purchase_history AS (
        SELECT 
          product_id,
          COUNT(*) as purchase_frequency,
          AVG(quantity) as avg_purchase_quantity,
          AVG(unit_cost) as avg_unit_cost,
          MAX(purchase_datetime) as last_purchase_date
        FROM purchases
        WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '90 days'
          AND is_deleted = false
        GROUP BY product_id
      ),
      current_inventory AS (
        SELECT 
          product_id,
          quantity_on_hand
        FROM inventory_snapshots
        WHERE snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      )
      SELECT 
        p.product_id,
        p.sku,
        p.product_name,
        p.category,
        COALESCE(ph.avg_purchase_quantity, 0) as avg_monthly_purchase,
        CEIL(sv.daily_velocity * $1) as predicted_next_month,
        GREATEST(
          CEIL(sv.daily_velocity * $1) - COALESCE(ci.quantity_on_hand, 0),
          p.moq,
          0
        ) as recommended_order_quantity,
        GREATEST(
          CEIL(sv.daily_velocity * $1) - COALESCE(ci.quantity_on_hand, 0),
          p.moq,
          0
        ) * COALESCE(ph.avg_unit_cost, p.cost) as estimated_cost,
        CASE 
          WHEN sv.sale_frequency >= 20 AND ph.purchase_frequency >= 3 THEN 0.95
          WHEN sv.sale_frequency >= 10 AND ph.purchase_frequency >= 2 THEN 0.85
          WHEN sv.sale_frequency >= 5 THEN 0.75
          ELSE 0.60
        END as confidence
      FROM products p
      LEFT JOIN sales_velocity sv ON p.product_id = sv.product_id
      LEFT JOIN purchase_history ph ON p.product_id = ph.product_id
      LEFT JOIN current_inventory ci ON p.product_id = ci.product_id
      WHERE p.is_deleted = false
        AND sv.daily_velocity > 0
        AND (COALESCE(ci.quantity_on_hand, 0) < (sv.daily_velocity * 14))
      ORDER BY 
        (sv.daily_velocity * $1) - COALESCE(ci.quantity_on_hand, 0) DESC,
        confidence DESC
      LIMIT $2
    `;

    const result: PurchaseForecastRow[] = await QueryBuilder.executeWithDebug<PurchaseForecastRow[]>(
      app.prisma,
      query,
      [daysAhead, limit],
      'PurchasesQueries.getPurchaseForecast'
    );

    return result.map(({
      product_id,
      sku,
      product_name,
      category,
      avg_monthly_purchase,
      predicted_next_month,
      recommended_order_quantity,
      estimated_cost,
      confidence
    }: PurchaseForecastRow) => ({
      product_id: Number(product_id),
      sku,
      product_name,
      category,
      avg_monthly_purchase: Number(avg_monthly_purchase) || 0,
      predicted_next_month: Number(predicted_next_month) || 0,
      recommended_order_quantity: Number(recommended_order_quantity) || 0,
      estimated_cost: Number(estimated_cost) || 0,
      confidence: Number(confidence) || 0
    }));
  }

  /**
   * Identify supplier risks based on performance metrics
   */
  static async getSupplierRiskAnalysis(app: AppWithPrisma): Promise<SupplierRisk[]> {
    const query = `
      WITH supplier_metrics AS (
        SELECT 
          s.supplier_id,
          s.supplier_name,
          s.rating,
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE p.on_time_delivery = false) as late_deliveries,
          AVG(p.late_days) FILTER (WHERE p.late_days > 0) as avg_late_days,
          AVG(p.quality_score) FILTER (WHERE p.quality_score IS NOT NULL) as avg_quality_score,
          MAX(p.purchase_datetime) as last_order_date,
          EXTRACT(DAY FROM (CURRENT_DATE - MAX(p.purchase_datetime))) as days_since_last_order
        FROM suppliers s
        LEFT JOIN purchases p ON s.supplier_id = p.supplier_id
          AND p.purchase_datetime >= CURRENT_DATE - INTERVAL '90 days'
          AND p.is_deleted = false
        WHERE s.is_active = true
        GROUP BY s.supplier_id, s.supplier_name, s.rating
      )
      SELECT 
        supplier_id,
        supplier_name,
        rating,
        total_orders,
        late_deliveries,
        COALESCE(avg_late_days, 0) as avg_late_days,
        COALESCE(avg_quality_score, 0) as avg_quality_score,
        last_order_date,
        days_since_last_order,
        CASE 
          WHEN total_orders = 0 THEN 'inactive'
          WHEN (late_deliveries::FLOAT / NULLIF(total_orders, 0) > 0.3) THEN 'high_risk'
          WHEN (COALESCE(avg_quality_score, 0) < 70) THEN 'high_risk'
          WHEN (late_deliveries::FLOAT / NULLIF(total_orders, 0) > 0.15) THEN 'medium_risk'
          WHEN (COALESCE(avg_quality_score, 0) < 85) THEN 'medium_risk'
          ELSE 'low_risk'
        END as risk_level
      FROM supplier_metrics
      WHERE total_orders > 0
      ORDER BY 
        CASE 
          WHEN (late_deliveries::FLOAT / NULLIF(total_orders, 0) > 0.3) THEN 1
          WHEN (COALESCE(avg_quality_score, 0) < 70) THEN 1
          WHEN (late_deliveries::FLOAT / NULLIF(total_orders, 0) > 0.15) THEN 2
          WHEN (COALESCE(avg_quality_score, 0) < 85) THEN 2
          ELSE 3
        END,
        total_orders DESC
    `;

    const result: SupplierRiskRow[] = await QueryBuilder.executeWithDebug<SupplierRiskRow[]>(
      app.prisma,
      query,
      [],
      'PurchasesQueries.getSupplierRiskAnalysis'
    );

    return result.map(({
      supplier_id,
      supplier_name,
      rating,
      total_orders,
      late_deliveries,
      avg_late_days,
      avg_quality_score,
      last_order_date,
      days_since_last_order,
      risk_level
    }: SupplierRiskRow) => ({
      supplier_id: Number(supplier_id),
      supplier_name,
      rating: Number(rating) || 0,
      total_orders: Number(total_orders) || 0,
      late_deliveries: Number(late_deliveries) || 0,
      avg_late_days: Number(avg_late_days) || 0,
      avg_quality_score: Number(avg_quality_score) || 0,
      last_order_date,
      days_since_last_order: Number(days_since_last_order) || 0,
      risk_level
    }));
  }

  /**
   * Calculate savings opportunities by comparing current costs to historical averages
   */
  static async getSavingsOpportunities(app: AppWithPrisma, limit: number = 10): Promise<SavingsOpportunity[]> {
    const query = `
      WITH price_analysis AS (
        SELECT 
          pr.product_id,
          pr.sku,
          pr.product_name,
          pr.category,
          p.supplier_id,
          s.supplier_name,
          AVG(p.unit_cost) FILTER (WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '30 days') as recent_avg_cost,
          AVG(p.unit_cost) FILTER (WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '180 days' 
                                    AND p.purchase_datetime < CURRENT_DATE - INTERVAL '30 days') as historical_avg_cost,
          SUM(p.quantity) FILTER (WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '30 days') as recent_quantity
        FROM purchases p
        JOIN products pr ON p.product_id = pr.product_id
        JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE p.is_deleted = false
        GROUP BY pr.product_id, pr.sku, pr.product_name, pr.category, p.supplier_id, s.supplier_name
        HAVING AVG(p.unit_cost) FILTER (WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '30 days') > 
               AVG(p.unit_cost) FILTER (WHERE p.purchase_datetime >= CURRENT_DATE - INTERVAL '180 days' 
                                        AND p.purchase_datetime < CURRENT_DATE - INTERVAL '30 days') * 1.05
      )
      SELECT 
        product_id,
        sku,
        product_name,
        category,
        supplier_name,
        recent_avg_cost,
        historical_avg_cost,
        recent_quantity,
        ((recent_avg_cost - historical_avg_cost) / historical_avg_cost * 100) as cost_increase_percentage,
        ((recent_avg_cost - historical_avg_cost) * recent_quantity) as potential_savings
      FROM price_analysis
      ORDER BY potential_savings DESC
      LIMIT $1
    `;

    const result: SavingsOpportunityRow[] = await QueryBuilder.executeWithDebug<SavingsOpportunityRow[]>(
      app.prisma,
      query,
      [limit],
      'PurchasesQueries.getSavingsOpportunities'
    );

    return result.map(({
      product_id,
      sku,
      product_name,
      category,
      supplier_name,
      recent_avg_cost,
      historical_avg_cost,
      recent_quantity,
      cost_increase_percentage,
      potential_savings
    }: SavingsOpportunityRow) => ({
      product_id: Number(product_id),
      sku,
      product_name,
      category,
      supplier_name,
      recent_avg_cost: Number(recent_avg_cost) || 0,
      historical_avg_cost: Number(historical_avg_cost) || 0,
      recent_quantity: Number(recent_quantity) || 0,
      cost_increase_percentage: Number(cost_increase_percentage) || 0,
      potential_savings: Number(potential_savings) || 0
    }));
  }
}
