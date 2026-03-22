import { FastifyInstance } from 'fastify';

interface CLVDistribution {
  brackets: CLVBracket[];
  summary: CLVSummary;
  trends: CLVTrend[];
  cohorts: CLVCohort[];
}

interface CLVBracket {
  bracket: string;
  min_value: number;
  max_value: number;
  customer_count: number;
  total_value: number;
  percentage_of_customers: number;
  percentage_of_revenue: number;
  avg_order_frequency: number;
  avg_order_value: number;
}

interface CLVSummary {
  total_customers: number;
  total_revenue: number;
  avg_clv: number;
  median_clv: number;
  top_10_percent_threshold: number;
  pareto_ratio: {
    customer_percentage: number;
    revenue_percentage: number;
  };
}

interface CLVTrend {
  period: string;
  avg_clv: number;
  new_customers: number;
  retained_customers: number;
}

interface CLVCohort {
  cohort_month: string;
  customers: number;
  avg_clv_to_date: number;
  avg_months_active: number;
  retention_rate: number;
}

interface CLVBracketRow {
  bracket: string;
  min_value: string | number | null;
  max_value: string | number | null;
  customer_count: string | number | null;
  total_value: string | number | null;
  percentage_of_customers: string | number | null;
  percentage_of_revenue: string | number | null;
  avg_order_frequency: string | number | null;
  avg_order_value: string | number | null;
}

interface CLVSummaryRow {
  total_customers: string | number | null;
  total_revenue: string | number | null;
  avg_clv: string | number | null;
  median_clv: string | number | null;
  top_10_percent_threshold: string | number | null;
  pareto_customer_percentage: string | number | null;
  pareto_revenue_percentage: string | number | null;
}

interface CLVTrendRow {
  period: string;
  avg_clv: string | number | null;
  customer_count: string | number | null;
}

interface CLVCohortRow {
  cohort_month: string;
  customers: string | number | null;
  avg_clv_to_date: string | number | null;
  avg_months_active: string | number | null;
  retention_rate: string | number | null;
}

interface CLVPredictRow {
  client_id: number;
  historical_value: string | number | null;
  avg_order_value: string | number | null;
  order_count: string | number | null;
  active_months: string | number | null;
  predicted_24_month_value: string | number | null;
  confidence_score: string | number | null;
}

export class CLVService {
  static async getCLVDistribution(app: FastifyInstance): Promise<CLVDistribution> {
    // Get CLV brackets with detailed metrics
    const bracketsQuery = `
      WITH customer_metrics AS (
        SELECT 
          c.client_id,
          c.client_name,
          MIN(sp.sale_datetime) as first_purchase,
          MAX(sp.sale_datetime) as last_purchase,
          COUNT(DISTINCT sp.sale_datetime::date) as order_count,
          SUM(sp.total_price) as lifetime_value,
          AVG(sp.total_price) as avg_order_value,
          EXTRACT(MONTH FROM age(MAX(sp.sale_datetime), MIN(sp.sale_datetime))) + 1 as months_active
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
        GROUP BY c.client_id, c.client_name
      ),
      value_brackets AS (
        SELECT 
          CASE 
            WHEN lifetime_value >= 500000 THEN 'Platinum (Q500K+)'
            WHEN lifetime_value >= 200000 THEN 'Gold (Q200K-Q500K)'
            WHEN lifetime_value >= 100000 THEN 'Silver (Q100K-Q200K)'
            WHEN lifetime_value >= 50000 THEN 'Bronze (Q50K-Q100K)'
            WHEN lifetime_value >= 20000 THEN 'Regular (Q20K-Q50K)'
            WHEN lifetime_value >= 10000 THEN 'Occasional (Q10K-Q20K)'
            WHEN lifetime_value >= 5000 THEN 'Rare (Q5K-Q10K)'
            ELSE 'Minimal (< Q5K)'
          END as bracket,
          CASE 
            WHEN lifetime_value >= 500000 THEN 500000
            WHEN lifetime_value >= 200000 THEN 200000
            WHEN lifetime_value >= 100000 THEN 100000
            WHEN lifetime_value >= 50000 THEN 50000
            WHEN lifetime_value >= 20000 THEN 20000
            WHEN lifetime_value >= 10000 THEN 10000
            WHEN lifetime_value >= 5000 THEN 5000
            ELSE 0
          END as min_value,
          CASE 
            WHEN lifetime_value >= 500000 THEN 999999999
            WHEN lifetime_value >= 200000 THEN 500000
            WHEN lifetime_value >= 100000 THEN 200000
            WHEN lifetime_value >= 50000 THEN 100000
            WHEN lifetime_value >= 20000 THEN 50000
            WHEN lifetime_value >= 10000 THEN 20000
            WHEN lifetime_value >= 5000 THEN 10000
            ELSE 5000
          END as max_value,
          COUNT(*) as customer_count,
          SUM(lifetime_value) as total_value,
          AVG(order_count) as avg_order_frequency,
          AVG(avg_order_value) as avg_order_value
        FROM customer_metrics
        GROUP BY 1, 2, 3
      )
      SELECT 
        bracket,
        min_value,
        max_value,
        customer_count,
        total_value,
        ROUND(100.0 * customer_count / SUM(customer_count) OVER(), 2) as percentage_of_customers,
        ROUND(100.0 * total_value / SUM(total_value) OVER(), 2) as percentage_of_revenue,
        avg_order_frequency,
        avg_order_value
      FROM value_brackets
      ORDER BY min_value DESC
    `;

    const brackets = await app.prisma.$queryRawUnsafe<CLVBracketRow[]>(bracketsQuery);

    // Get summary statistics
    const summaryQuery = `
      WITH customer_values AS (
        SELECT 
          c.client_id,
          SUM(sp.total_price) as lifetime_value
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
        GROUP BY c.client_id
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lifetime_value) as median_clv,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY lifetime_value) as top_10_percent
        FROM customer_values
      ),
      pareto AS (
        SELECT 
          COUNT(*) FILTER (WHERE lifetime_value >= (SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY lifetime_value) FROM customer_values)) as top_20_percent_customers,
          SUM(lifetime_value) FILTER (WHERE lifetime_value >= (SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY lifetime_value) FROM customer_values)) as top_20_percent_revenue
        FROM customer_values
      )
      SELECT 
        COUNT(*) as total_customers,
        SUM(cv.lifetime_value) as total_revenue,
        AVG(cv.lifetime_value) as avg_clv,
        p.median_clv,
        p.top_10_percent as top_10_percent_threshold,
        ROUND(100.0 * pr.top_20_percent_customers / COUNT(*), 2) as pareto_customer_percentage,
        ROUND(100.0 * pr.top_20_percent_revenue / SUM(cv.lifetime_value), 2) as pareto_revenue_percentage
      FROM customer_values cv
      CROSS JOIN percentiles p
      CROSS JOIN pareto pr
      GROUP BY p.median_clv, p.top_10_percent, pr.top_20_percent_customers, pr.top_20_percent_revenue
    `;

    const [summary] = await app.prisma.$queryRawUnsafe<CLVSummaryRow[]>(summaryQuery);

    // Get CLV trends over time
    const trendsQuery = `
      WITH customer_first_purchase AS (
        SELECT 
          c.client_id,
          MIN(sp.sale_datetime) as first_purchase_date
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '12 months'
        GROUP BY c.client_id
      ),
      monthly_cohorts AS (
        SELECT 
          DATE_TRUNC('month', cfp.first_purchase_date) as cohort_month,
          c.client_id,
          SUM(sp.total_price) as period_value
        FROM clients c
        JOIN customer_first_purchase cfp ON c.client_id = cfp.client_id
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', cfp.first_purchase_date), c.client_id
      ),
      monthly_metrics AS (
        SELECT 
          TO_CHAR(cohort_month, 'YYYY-MM') as period,
          AVG(period_value) as avg_clv,
          COUNT(DISTINCT client_id) as customer_count
        FROM monthly_cohorts
        GROUP BY cohort_month
        ORDER BY cohort_month DESC
        LIMIT 12
      )
      SELECT * FROM monthly_metrics ORDER BY period
    `;

    const trends = await app.prisma.$queryRawUnsafe<CLVTrendRow[]>(trendsQuery);

    // Get cohort analysis
    const cohortsQuery = `
      WITH customer_cohorts AS (
        SELECT 
          c.client_id,
          DATE_TRUNC('month', MIN(sp.sale_datetime)) as cohort_month,
          SUM(sp.total_price) as lifetime_value,
          COUNT(DISTINCT DATE_TRUNC('month', sp.sale_datetime)) as active_months,
          MAX(sp.sale_datetime) as last_purchase
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
        GROUP BY c.client_id
      ),
      cohort_summary AS (
        SELECT 
          TO_CHAR(cohort_month, 'YYYY-MM') as cohort_month,
          COUNT(*) as customers,
          AVG(lifetime_value) as avg_clv_to_date,
          AVG(active_months) as avg_months_active,
          COUNT(*) FILTER (WHERE last_purchase >= NOW() - INTERVAL '90 days') * 100.0 / COUNT(*) as retention_rate
        FROM customer_cohorts
        WHERE cohort_month >= NOW() - INTERVAL '24 months'
        GROUP BY cohort_month
        ORDER BY cohort_month DESC
        LIMIT 24
      )
      SELECT * FROM cohort_summary ORDER BY cohort_month
    `;

    const cohorts = await app.prisma.$queryRawUnsafe<CLVCohortRow[]>(cohortsQuery);

    return {
      brackets: brackets.map(b => ({
        bracket: b.bracket,
        min_value: Number(b.min_value),
        max_value: Number(b.max_value),
        customer_count: Number(b.customer_count),
        total_value: Number(b.total_value),
        percentage_of_customers: Number(b.percentage_of_customers),
        percentage_of_revenue: Number(b.percentage_of_revenue),
        avg_order_frequency: Number(b.avg_order_frequency),
        avg_order_value: Number(b.avg_order_value)
      })),
      summary: {
        total_customers: Number(summary.total_customers),
        total_revenue: Number(summary.total_revenue),
        avg_clv: Number(summary.avg_clv),
        median_clv: Number(summary.median_clv),
        top_10_percent_threshold: Number(summary.top_10_percent_threshold),
        pareto_ratio: {
          customer_percentage: Number(summary.pareto_customer_percentage),
          revenue_percentage: Number(summary.pareto_revenue_percentage)
        }
      },
      trends: trends.map(t => ({
        period: t.period,
        avg_clv: Number(t.avg_clv),
        new_customers: 0,
        retained_customers: Number(t.customer_count)
      })),
      cohorts: cohorts.map(c => ({
        cohort_month: c.cohort_month,
        customers: Number(c.customers),
        avg_clv_to_date: Number(c.avg_clv_to_date),
        avg_months_active: Number(c.avg_months_active),
        retention_rate: Number(c.retention_rate)
      }))
    };
  }

  static async predictCLV(app: FastifyInstance, clientId: number): Promise<CLVPredictRow | null> {
    // Simple CLV prediction based on historical patterns
    const query = `
      WITH customer_history AS (
        SELECT 
          c.client_id,
          MIN(sp.sale_datetime) as first_purchase,
          MAX(sp.sale_datetime) as last_purchase,
          COUNT(DISTINCT DATE_TRUNC('month', sp.sale_datetime)) as active_months,
          SUM(sp.total_price) as historical_value,
          AVG(sp.total_price) as avg_order_value,
          COUNT(DISTINCT sp.sale_datetime::date) as order_count
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND c.client_id = $1
        GROUP BY c.client_id
      )
      SELECT 
        client_id,
        historical_value,
        avg_order_value,
        order_count,
        active_months,
        -- Simple prediction: avg monthly value * expected lifetime months
        (historical_value / NULLIF(active_months, 0)) * 24 as predicted_24_month_value,
        -- Confidence based on data points
        LEAST(100, active_months * 10) as confidence_score
      FROM customer_history
    `;

    const [prediction] = await app.prisma.$queryRawUnsafe<CLVPredictRow[]>(query, clientId);
    
    return prediction || null;
  }
}