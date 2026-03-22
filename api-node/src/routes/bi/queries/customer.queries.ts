import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

interface SegmentDistributionRow {
  segment_name: string;
  description: string;
  color_code: string;
  marketing_strategy: string;
  customer_count: number | null;
  total_revenue: number | null;
  avg_order_value: number | null;
  avg_churn_risk: number | null;
}

export interface SegmentDistributionEntry {
  segment_name: string;
  description: string;
  color_code: string;
  marketing_strategy: string;
  customer_count: number;
  total_revenue: number;
  avg_order_value: number;
  avg_churn_risk: number;
}

interface RFMMatrixRow {
  rfm_recency: number | null;
  rfm_frequency: number | null;
  customer_count: number | null;
  total_revenue: number | null;
  avg_churn_risk: number | null;
}

export interface RFMMatrixEntry {
  rfm_recency: number;
  rfm_frequency: number;
  customer_count: number;
  total_revenue: number;
  avg_churn_risk: number;
}

interface CohortAnalysisRow {
  cohort_month: string;
  cohort_customers: number | null;
  months_since_first: number | null;
  active_customers: number | null;
  retention_rate: number | null;
}

export interface CohortAnalysisEntry {
  cohort_month: string;
  cohort_customers: number;
  months_since_first: number;
  active_customers: number;
  retention_rate: number;
}

interface CLVDistributionRow {
  clv_bucket: string;
  customer_count: number | null;
  total_revenue: number | null;
  avg_clv: number | null;
}

export interface CLVDistributionEntry {
  clv_bucket: string;
  customer_count: number;
  total_revenue: number;
  avg_clv: number;
}

interface TopCustomerSegmentRow {
  client_id: number | null;
  client_name: string | null;
  segment: string | null;
  rfm_score: number | null;
  total_orders: number | null;
  total_spent: number | null;
  avg_order_value: number | null;
  lifetime_value: number | null;
  churn_risk_score: number | null;
  last_purchase_date: string | null;
  days_since_last_purchase: number | null;
}

export interface TopCustomerSegmentEntry {
  client_id: number;
  client_name: string | null;
  segment: string | null;
  rfm_score: number;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  lifetime_value: number;
  churn_risk_score: number;
  last_purchase_date: string | null;
  days_since_last_purchase: number;
}

interface ChurnRiskRow {
  churn_risk_level: string;
  customer_count: number | null;
  revenue_at_risk: number | null;
  avg_churn_score: number | null;
  clv_at_risk: number | null;
}

export interface ChurnRiskEntry {
  churn_risk_level: string;
  customer_count: number;
  revenue_at_risk: number;
  avg_churn_score: number;
  clv_at_risk: number;
}

export class CustomerQueries {
  /**
   * Calculate RFM scores and segments for all customers
   * Uses quintile-based scoring (1-5 for each dimension)
   */
  static async calculateRFMScores(app: AppWithPrisma, asOfDate?: Date): Promise<void> {
    const referenceDate = asOfDate || new Date();
    
    const query = `
      WITH customer_metrics AS (
        SELECT 
          c.client_id,
          c.client_name,
          COALESCE(COUNT(DISTINCT s.sale_id), 0) as total_orders,
          COALESCE(SUM(s.total_price), 0) as total_spent,
          COALESCE(MAX(s.sale_datetime), c.created_at) as last_purchase_date,
          COALESCE(MIN(s.sale_datetime), c.created_at) as first_purchase_date,
          EXTRACT(days FROM ($1::date - COALESCE(MAX(s.sale_datetime), c.created_at))) as days_since_last_purchase
        FROM clients c
        LEFT JOIN sales_partitioned s ON c.client_id = s.client_id AND s.is_deleted = false
        WHERE c.is_deleted = false
        GROUP BY c.client_id, c.client_name, c.created_at
      ),
      rfm_percentiles AS (
        SELECT 
          client_id,
          days_since_last_purchase,
          total_orders,
          total_spent,
          -- Recency: Lower days = better = higher score (inverted quintiles)
          CASE 
            WHEN days_since_last_purchase <= 30 THEN 5
            WHEN days_since_last_purchase <= 60 THEN 4
            WHEN days_since_last_purchase <= 90 THEN 3
            WHEN days_since_last_purchase <= 180 THEN 2
            ELSE 1
          END as rfm_recency,
          -- Frequency: More orders = higher score
          CASE 
            WHEN total_orders >= 20 THEN 5
            WHEN total_orders >= 10 THEN 4
            WHEN total_orders >= 5 THEN 3
            WHEN total_orders >= 2 THEN 2
            ELSE 1
          END as rfm_frequency,
          -- Monetary: More spent = higher score
          CASE 
            WHEN total_spent >= 10000 THEN 5
            WHEN total_spent >= 5000 THEN 4
            WHEN total_spent >= 2000 THEN 3
            WHEN total_spent >= 500 THEN 2
            ELSE 1
          END as rfm_monetary
        FROM customer_metrics
      ),
      rfm_with_segments AS (
        SELECT 
          cm.*,
          rp.rfm_recency,
          rp.rfm_frequency,
          rp.rfm_monetary,
          (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) as rfm_score,
          CASE 
            WHEN (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) >= 12 THEN 'Champions'
            WHEN (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) >= 9 
              AND rp.rfm_recency >= 4 THEN 'Loyal'
            WHEN (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) >= 8 
              AND rp.rfm_recency >= 4 AND rp.rfm_frequency <= 3 THEN 'Potential Loyalist'
            WHEN rp.rfm_recency >= 4 AND rp.rfm_frequency = 1 THEN 'New Customer'
            WHEN rp.rfm_recency >= 4 AND rp.rfm_monetary <= 2 THEN 'Promising'
            WHEN rp.rfm_recency = 3 AND rp.rfm_frequency >= 2 THEN 'Need Attention'
            WHEN rp.rfm_recency <= 3 AND rp.rfm_frequency <= 2 THEN 'About To Sleep'
            WHEN rp.rfm_recency <= 2 AND rp.rfm_frequency >= 4 THEN 'At Risk'
            WHEN rp.rfm_recency = 1 AND rp.rfm_frequency >= 3 AND rp.rfm_monetary >= 4 THEN 'Cant Lose'
            WHEN rp.rfm_recency <= 2 AND rp.rfm_frequency <= 2 AND rp.rfm_monetary <= 2 THEN 'Hibernating'
            ELSE 'Lost'
          END as segment,
          -- Calculate CLV (simple: total_spent * expected_repeat_rate * avg_lifespan_years)
          cm.total_spent * LEAST(rp.rfm_frequency / 5.0, 1.0) * 2.0 as lifetime_value,
          -- Churn risk score (0-100): inversely related to RFM score
          ROUND(100 - ((rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) / 15.0 * 100), 2) as churn_risk_score,
          CASE 
            WHEN (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) >= 10 THEN 'Low'
            WHEN (rp.rfm_recency + rp.rfm_frequency + rp.rfm_monetary) >= 6 THEN 'Medium'
            ELSE 'High'
          END as churn_risk_level,
          DATE_TRUNC('month', cm.first_purchase_date)::date as cohort_month
        FROM customer_metrics cm
        JOIN rfm_percentiles rp ON cm.client_id = rp.client_id
      )
      UPDATE clients c
      SET 
        first_purchase_date = r.first_purchase_date,
        last_purchase_date = r.last_purchase_date,
        total_orders = r.total_orders,
        total_spent = r.total_spent,
        avg_order_value = CASE WHEN r.total_orders > 0 THEN r.total_spent / r.total_orders ELSE 0 END,
        rfm_recency = r.rfm_recency,
        rfm_frequency = r.rfm_frequency,
        rfm_monetary = r.rfm_monetary,
        segment = r.segment,
        lifetime_value = r.lifetime_value,
        churn_risk_score = r.churn_risk_score,
        churn_risk_level = r.churn_risk_level,
        cohort_month = r.cohort_month,
        last_updated = NOW()
      FROM rfm_with_segments r
      WHERE c.client_id = r.client_id
    `;

    await QueryBuilder.executeWithDebug(
      app.prisma,
      query,
      [referenceDate],
      'CustomerQueries.calculateRFMScores'
    );
  }

  /**
   * Get customer segmentation overview
   */
  static async getSegmentDistribution(app: AppWithPrisma): Promise<SegmentDistributionEntry[]> {
    const query = `
      SELECT 
        cs.segment_name,
        cs.description,
        cs.color_code,
        cs.marketing_strategy,
        COUNT(c.client_id) as customer_count,
        COALESCE(SUM(c.total_spent), 0) as total_revenue,
        COALESCE(AVG(c.avg_order_value), 0) as avg_order_value,
        COALESCE(AVG(c.churn_risk_score), 0) as avg_churn_risk
      FROM customer_segments cs
      LEFT JOIN clients c ON cs.segment_name = c.segment AND c.is_deleted = false
      GROUP BY cs.segment_id, cs.segment_name, cs.description, cs.color_code, cs.marketing_strategy
      ORDER BY cs.min_rfm_score DESC
    `;

    const result = await QueryBuilder.executeWithDebug<SegmentDistributionRow[]>(
      app.prisma,
      query,
      [],
      'CustomerQueries.getSegmentDistribution'
    );

    return result.map(r => ({
      segment_name: r.segment_name,
      description: r.description,
      color_code: r.color_code,
      marketing_strategy: r.marketing_strategy,
      customer_count: Number(r.customer_count) || 0,
      total_revenue: Number(r.total_revenue) || 0,
      avg_order_value: Number(r.avg_order_value) || 0,
      avg_churn_risk: Number(r.avg_churn_risk) || 0
    }));
  }

  /**
   * Get RFM matrix data for heatmap visualization
   */
  static async getRFMMatrix(app: AppWithPrisma): Promise<RFMMatrixEntry[]> {
    const query = `
      SELECT 
        rfm_recency,
        rfm_frequency,
        COUNT(*) as customer_count,
        SUM(total_spent) as total_revenue,
        AVG(churn_risk_score) as avg_churn_risk
      FROM clients
      WHERE is_deleted = false
        AND rfm_recency IS NOT NULL
        AND rfm_frequency IS NOT NULL
      GROUP BY rfm_recency, rfm_frequency
      ORDER BY rfm_recency DESC, rfm_frequency DESC
    `;

    const result = await QueryBuilder.executeWithDebug<RFMMatrixRow[]>(
      app.prisma,
      query,
      [],
      'CustomerQueries.getRFMMatrix'
    );

    return result.map(r => ({
      rfm_recency: Number(r.rfm_recency),
      rfm_frequency: Number(r.rfm_frequency),
      customer_count: Number(r.customer_count) || 0,
      total_revenue: Number(r.total_revenue) || 0,
      avg_churn_risk: Number(r.avg_churn_risk) || 0
    }));
  }

  /**
   * Get cohort retention analysis
   */
  static async getCohortAnalysis(app: AppWithPrisma, months: number = 12): Promise<CohortAnalysisEntry[]> {
    const query = `
      WITH cohort_items AS (
        SELECT 
          c.client_id,
          c.cohort_month,
          DATE_TRUNC('month', s.sale_datetime)::date as order_month,
          EXTRACT(year FROM AGE(s.sale_datetime, c.cohort_month)) * 12 +
          EXTRACT(month FROM AGE(s.sale_datetime, c.cohort_month)) as months_since_first
        FROM clients c
        JOIN sales_partitioned s ON c.client_id = s.client_id
        WHERE c.is_deleted = false
          AND s.is_deleted = false
          AND c.cohort_month >= CURRENT_DATE - INTERVAL '${months} months'
      ),
      cohort_size AS (
        SELECT 
          cohort_month,
          COUNT(DISTINCT client_id) as cohort_customers
        FROM clients
        WHERE cohort_month >= CURRENT_DATE - INTERVAL '${months} months'
          AND is_deleted = false
        GROUP BY cohort_month
      )
      SELECT 
        cs.cohort_month,
        cs.cohort_customers,
        ci.months_since_first,
        COUNT(DISTINCT ci.client_id) as active_customers,
        ROUND((COUNT(DISTINCT ci.client_id)::numeric / cs.cohort_customers * 100), 2) as retention_rate
      FROM cohort_size cs
      LEFT JOIN cohort_items ci ON cs.cohort_month = ci.cohort_month
      WHERE ci.months_since_first IS NOT NULL OR ci.months_since_first = 0
      GROUP BY cs.cohort_month, cs.cohort_customers, ci.months_since_first
      ORDER BY cs.cohort_month, ci.months_since_first
    `;

    const result = await QueryBuilder.executeWithDebug<CohortAnalysisRow[]>(
      app.prisma,
      query,
      [],
      'CustomerQueries.getCohortAnalysis'
    );

    return result.map(r => ({
      cohort_month: r.cohort_month,
      cohort_customers: Number(r.cohort_customers) || 0,
      months_since_first: Number(r.months_since_first) || 0,
      active_customers: Number(r.active_customers) || 0,
      retention_rate: Number(r.retention_rate) || 0
    }));
  }

  /**
   * Get customer lifetime value distribution
   */
  static async getCLVDistribution(app: AppWithPrisma): Promise<CLVDistributionEntry[]> {
    const query = `
      SELECT 
        CASE 
          WHEN lifetime_value >= 10000 THEN '10000+'
          WHEN lifetime_value >= 5000 THEN '5000-10000'
          WHEN lifetime_value >= 2000 THEN '2000-5000'
          WHEN lifetime_value >= 1000 THEN '1000-2000'
          WHEN lifetime_value >= 500 THEN '500-1000'
          ELSE '0-500'
        END as clv_bucket,
        COUNT(*) as customer_count,
        SUM(total_spent) as total_revenue,
        AVG(lifetime_value) as avg_clv
      FROM clients
      WHERE is_deleted = false
        AND lifetime_value IS NOT NULL
      GROUP BY clv_bucket
      ORDER BY MIN(lifetime_value) DESC
    `;

    const result = await QueryBuilder.executeWithDebug<CLVDistributionRow[]>(
      app.prisma,
      query,
      [],
      'CustomerQueries.getCLVDistribution'
    );

    return result.map(r => ({
      clv_bucket: r.clv_bucket,
      customer_count: Number(r.customer_count) || 0,
      total_revenue: Number(r.total_revenue) || 0,
      avg_clv: Number(r.avg_clv) || 0
    }));
  }

  /**
   * Get top customers by segment
   */
  static async getTopCustomersBySegment(app: AppWithPrisma, segment: string, limit: number = 10): Promise<TopCustomerSegmentEntry[]> {
    const query = `
      SELECT 
        client_id,
        client_name,
        segment,
        rfm_score,
        total_orders,
        total_spent,
        avg_order_value,
        lifetime_value,
        churn_risk_score,
        last_purchase_date,
        EXTRACT(days FROM (CURRENT_DATE - last_purchase_date)) as days_since_last_purchase
      FROM clients
      WHERE is_deleted = false
        AND segment = $1
      ORDER BY total_spent DESC
      LIMIT $2
    `;

    const result = await QueryBuilder.executeWithDebug<TopCustomerSegmentRow[]>(
      app.prisma,
      query,
      [segment, limit],
      'CustomerQueries.getTopCustomersBySegment'
    );

    return result.map(r => ({
      client_id: Number(r.client_id),
      client_name: r.client_name,
      segment: r.segment,
      rfm_score: Number(r.rfm_score) || 0,
      total_orders: Number(r.total_orders) || 0,
      total_spent: Number(r.total_spent) || 0,
      avg_order_value: Number(r.avg_order_value) || 0,
      lifetime_value: Number(r.lifetime_value) || 0,
      churn_risk_score: Number(r.churn_risk_score) || 0,
      last_purchase_date: r.last_purchase_date,
      days_since_last_purchase: Number(r.days_since_last_purchase) || 0
    }));
  }

  /**
   * Get churn risk dashboard
   */
  static async getChurnRiskAnalysis(app: AppWithPrisma): Promise<ChurnRiskEntry[]> {
    const query = `
      SELECT 
        churn_risk_level,
        COUNT(*) as customer_count,
        SUM(total_spent) as revenue_at_risk,
        AVG(churn_risk_score) as avg_churn_score,
        SUM(lifetime_value) as clv_at_risk
      FROM clients
      WHERE is_deleted = false
        AND churn_risk_level IS NOT NULL
      GROUP BY churn_risk_level
      ORDER BY 
        CASE churn_risk_level
          WHEN 'High' THEN 1
          WHEN 'Medium' THEN 2
          WHEN 'Low' THEN 3
        END
    `;

    const result = await QueryBuilder.executeWithDebug<ChurnRiskRow[]>(
      app.prisma,
      query,
      [],
      'CustomerQueries.getChurnRiskAnalysis'
    );

    return result.map(r => ({
      churn_risk_level: r.churn_risk_level,
      customer_count: Number(r.customer_count) || 0,
      revenue_at_risk: Number(r.revenue_at_risk) || 0,
      avg_churn_score: Number(r.avg_churn_score) || 0,
      clv_at_risk: Number(r.clv_at_risk) || 0
    }));
  }
}