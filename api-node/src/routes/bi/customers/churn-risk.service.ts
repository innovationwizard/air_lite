import { FastifyInstance } from 'fastify';

interface ChurnRiskAnalysis {
  summary: ChurnSummary;
  risk_groups: ChurnRiskGroup[];
  individual_risks: CustomerChurnRisk[];
  predictive_factors: PredictiveFactor[];
  retention_opportunities: RetentionOpportunity[];
  historical_churn: ChurnHistory[];
}

interface ChurnSummary {
  total_customers: number;
  at_risk_customers: number;
  high_risk_customers: number;
  potential_revenue_loss: number;
  predicted_churn_rate: number;
  current_retention_rate: number;
  avg_customer_lifetime: number;
}

interface ChurnRiskGroup {
  risk_level: 'Very Low' | 'Low' | 'Medium' | 'High' | 'Critical';
  customer_count: number;
  percentage: number;
  avg_days_since_purchase: number;
  avg_lifetime_value: number;
  potential_lost_revenue: number;
  churn_probability: number;
  key_indicators: string[];
  recommended_actions: string[];
  color: string;
}

interface CustomerChurnRisk {
  client_id: number;
  client_name: string;
  risk_score: number;
  risk_level: string;
  days_since_last_purchase: number;
  purchase_frequency_decline: number;
  lifetime_value: number;
  avg_order_value: number;
  total_orders: number;
  last_order_date: string;
  churn_probability: number;
  risk_factors: string[];
  retention_value: number;
}

interface PredictiveFactor {
  factor_name: string;
  importance_score: number;
  correlation: number;
  description: string;
  threshold_value: number;
}

interface RetentionOpportunity {
  opportunity_type: string;
  affected_customers: number;
  potential_revenue_save: number;
  recommended_action: string;
  expected_success_rate: number;
  priority: 'High' | 'Medium' | 'Low';
}

interface ChurnHistory {
  period: string;
  churned_customers: number;
  retained_customers: number;
  churn_rate: number;
  recovered_customers: number;
  revenue_impact: number;
}

interface ChurnSummaryRow {
  total_customers: string | number | null;
  at_risk_customers: string | number | null;
  high_risk_customers: string | number | null;
  potential_revenue_loss: string | number | null;
  predicted_churn_rate: string | number | null;
  current_retention_rate: string | number | null;
  avg_customer_lifetime: string | number | null;
}

interface RiskGroupRow {
  risk_level: string;
  customer_count: string | number | null;
  percentage: string | number | null;
  avg_days_since_purchase: string | number | null;
  avg_lifetime_value: string | number | null;
  potential_lost_revenue: string | number | null;
  churn_probability: string | number | null;
}

interface IndividualRiskRow {
  client_id: number;
  client_name: string;
  risk_score: string | number | null;
  risk_level: string;
  days_since_purchase: string | number | null;
  purchase_frequency_decline: string | number | null;
  lifetime_value: string | number | null;
  avg_order_value: string | number | null;
  total_orders: string | number | null;
  last_purchase: string | null;
  churn_probability: string | number | null;
  retention_value: string | number | null;
}

interface RetentionOpportunityRow {
  opportunity_type: string;
  affected_customers: string | number | null;
  potential_save: string | number | null;
}

interface HistoricalChurnRow {
  period: string;
  churned_customers: string | number | null;
  retained_customers: string | number | null;
  churn_rate: string | number | null;
  recovered_customers: string | number | null;
  revenue_impact: string | number | null;
}

export class ChurnRiskService {
  static async getChurnRiskAnalysis(app: FastifyInstance): Promise<ChurnRiskAnalysis> {
    // Get summary statistics
    const summary = await this.getChurnSummary(app);
    
    // Get risk groups
    const riskGroups = await this.getRiskGroups(app);
    
    // Get individual high-risk customers
    const individualRisks = await this.getIndividualRisks(app);
    
    // Get predictive factors
    const predictiveFactors = this.getPredictiveFactors();
    
    // Get retention opportunities
    const retentionOpportunities = await this.getRetentionOpportunities(app);
    
    // Get historical churn data
    const historicalChurn = await this.getHistoricalChurn(app);

    return {
      summary,
      risk_groups: riskGroups,
      individual_risks: individualRisks,
      predictive_factors: predictiveFactors,
      retention_opportunities: retentionOpportunities,
      historical_churn: historicalChurn
    };
  }

  private static async getChurnSummary(app: FastifyInstance): Promise<ChurnSummary> {
    const query = `
      WITH customer_metrics AS (
        SELECT 
          c.client_id,
          MAX(sp.sale_datetime) as last_purchase,
          MIN(sp.sale_datetime) as first_purchase,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
          COUNT(DISTINCT DATE_TRUNC('month', sp.sale_datetime)) as active_months,
          COUNT(DISTINCT sp.sale_datetime::date) as total_orders,
          SUM(sp.total_price) as lifetime_value,
          AVG(sp.total_price) as avg_order_value,
          -- Calculate purchase frequency trend
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime >= NOW() - INTERVAL '3 months') as recent_orders,
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime < NOW() - INTERVAL '3 months' 
            AND sp.sale_datetime >= NOW() - INTERVAL '6 months') as previous_orders
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
        GROUP BY c.client_id
      ),
      churn_analysis AS (
        SELECT 
          client_id,
          days_since_purchase,
          lifetime_value,
          CASE 
            WHEN days_since_purchase IS NULL THEN 100 -- Never purchased
            WHEN days_since_purchase > 180 THEN 90
            WHEN days_since_purchase > 120 THEN 70
            WHEN days_since_purchase > 90 THEN 50
            WHEN days_since_purchase > 60 THEN 30
            WHEN days_since_purchase > 30 THEN 10
            ELSE 5
          END as churn_probability,
          CASE 
            WHEN days_since_purchase > 120 OR days_since_purchase IS NULL THEN 'High'
            WHEN days_since_purchase > 60 THEN 'Medium'
            ELSE 'Low'
          END as risk_category,
          EXTRACT(DAY FROM age(last_purchase, first_purchase)) as customer_lifetime_days
        FROM customer_metrics
      )
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE risk_category IN ('Medium', 'High')) as at_risk_customers,
        COUNT(*) FILTER (WHERE risk_category = 'High') as high_risk_customers,
        SUM(lifetime_value) FILTER (WHERE risk_category IN ('Medium', 'High')) as potential_revenue_loss,
        AVG(churn_probability) as predicted_churn_rate,
        (COUNT(*) FILTER (WHERE days_since_purchase <= 90) * 100.0 / NULLIF(COUNT(*), 0)) as current_retention_rate,
        AVG(customer_lifetime_days) as avg_customer_lifetime
      FROM churn_analysis
    `;

    const [summary] = await app.prisma.$queryRawUnsafe<ChurnSummaryRow[]>(query);

    return {
      total_customers: Number(summary.total_customers) || 0,
      at_risk_customers: Number(summary.at_risk_customers) || 0,
      high_risk_customers: Number(summary.high_risk_customers) || 0,
      potential_revenue_loss: Number(summary.potential_revenue_loss) || 0,
      predicted_churn_rate: Number(summary.predicted_churn_rate) || 0,
      current_retention_rate: Number(summary.current_retention_rate) || 0,
      avg_customer_lifetime: Number(summary.avg_customer_lifetime) || 0
    };
  }

  private static async getRiskGroups(app: FastifyInstance): Promise<ChurnRiskGroup[]> {
    const query = `
      WITH customer_activity AS (
        SELECT 
          c.client_id,
          c.client_name,
          MAX(sp.sale_datetime) as last_purchase,
          MIN(sp.sale_datetime) as first_purchase,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
          COUNT(DISTINCT DATE_TRUNC('month', sp.sale_datetime)) as active_months,
          COUNT(DISTINCT sp.sale_datetime::date) as total_orders,
          SUM(sp.total_price) as lifetime_value,
          AVG(sp.total_price) as avg_order_value,
          -- Frequency decline calculation
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime >= NOW() - INTERVAL '3 months') as recent_orders,
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime < NOW() - INTERVAL '3 months' 
            AND sp.sale_datetime >= NOW() - INTERVAL '6 months') as previous_orders,
          -- Value decline calculation
          SUM(sp.total_price) FILTER (WHERE sp.sale_datetime >= NOW() - INTERVAL '3 months') as recent_value,
          SUM(sp.total_price) FILTER (WHERE sp.sale_datetime < NOW() - INTERVAL '3 months' 
            AND sp.sale_datetime >= NOW() - INTERVAL '6 months') as previous_value
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
        GROUP BY c.client_id, c.client_name
      ),
      risk_scoring AS (
        SELECT 
          *,
          -- Calculate risk score based on multiple factors
          CASE 
            WHEN days_since_purchase IS NULL THEN 100
            WHEN days_since_purchase > 365 THEN 95
            WHEN days_since_purchase > 180 THEN 85
            WHEN days_since_purchase > 120 THEN 70
            WHEN days_since_purchase > 90 THEN 50
            WHEN days_since_purchase > 60 THEN 30
            WHEN days_since_purchase > 30 THEN 15
            ELSE 5
          END +
          CASE 
            WHEN previous_orders > 0 AND recent_orders < previous_orders * 0.5 THEN 20
            WHEN previous_orders > 0 AND recent_orders < previous_orders THEN 10
            ELSE 0
          END as risk_score,
          -- Churn probability calculation
          CASE 
            WHEN days_since_purchase IS NULL THEN 99
            WHEN days_since_purchase > 180 THEN 
              LEAST(95, 50 + (days_since_purchase - 180) * 0.15)
            WHEN days_since_purchase > 90 THEN 
              30 + ((days_since_purchase - 90) * 0.22)
            WHEN days_since_purchase > 60 THEN 
              15 + ((days_since_purchase - 60) * 0.5)
            WHEN days_since_purchase > 30 THEN 
              5 + ((days_since_purchase - 30) * 0.33)
            ELSE 5
          END as churn_probability
        FROM customer_activity
      ),
      risk_groups AS (
        SELECT 
          CASE 
            WHEN risk_score >= 80 THEN 'Critical'
            WHEN risk_score >= 60 THEN 'High'
            WHEN risk_score >= 40 THEN 'Medium'
            WHEN risk_score >= 20 THEN 'Low'
            ELSE 'Very Low'
          END as risk_level,
          COUNT(*) as customer_count,
          AVG(days_since_purchase) as avg_days_since_purchase,
          AVG(lifetime_value) as avg_lifetime_value,
          SUM(lifetime_value) as total_lifetime_value,
          AVG(churn_probability) as avg_churn_probability
        FROM risk_scoring
        GROUP BY 1
      )
      SELECT 
        risk_level,
        customer_count,
        ROUND(100.0 * customer_count / SUM(customer_count) OVER(), 2) as percentage,
        avg_days_since_purchase,
        avg_lifetime_value,
        total_lifetime_value * (avg_churn_probability / 100) as potential_lost_revenue,
        avg_churn_probability as churn_probability
      FROM risk_groups
      ORDER BY 
        CASE risk_level
          WHEN 'Critical' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          WHEN 'Low' THEN 4
          ELSE 5
        END
    `;

    const groups = await app.prisma.$queryRawUnsafe<RiskGroupRow[]>(query);

    return groups.map(group => ({
      risk_level: group.risk_level as 'Very Low' | 'Low' | 'Medium' | 'High' | 'Critical',
      customer_count: Number(group.customer_count),
      percentage: Number(group.percentage),
      avg_days_since_purchase: Number(group.avg_days_since_purchase) || 0,
      avg_lifetime_value: Number(group.avg_lifetime_value) || 0,
      potential_lost_revenue: Number(group.potential_lost_revenue) || 0,
      churn_probability: Number(group.churn_probability) || 0,
      key_indicators: this.getKeyIndicators(group.risk_level),
      recommended_actions: this.getRecommendedActions(group.risk_level),
      color: this.getRiskColor(group.risk_level)
    }));
  }

  private static async getIndividualRisks(app: FastifyInstance): Promise<CustomerChurnRisk[]> {
    const query = `
      WITH customer_analysis AS (
        SELECT 
          c.client_id,
          c.client_name,
          MAX(sp.sale_datetime) as last_purchase,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
          COUNT(DISTINCT sp.sale_datetime::date) as total_orders,
          SUM(sp.total_price) as lifetime_value,
          AVG(sp.total_price) as avg_order_value,
          -- Frequency trend
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime >= NOW() - INTERVAL '3 months') as recent_orders,
          COUNT(DISTINCT sp.sale_datetime::date) FILTER (WHERE sp.sale_datetime < NOW() - INTERVAL '3 months' 
            AND sp.sale_datetime >= NOW() - INTERVAL '6 months') as previous_orders
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
        GROUP BY c.client_id, c.client_name
      ),
      risk_calculation AS (
        SELECT 
          *,
          CASE 
            WHEN previous_orders > 0 THEN 
              ((previous_orders - recent_orders) * 100.0 / previous_orders)
            ELSE 0
          END as frequency_decline,
          -- Risk score calculation
          CASE 
            WHEN days_since_purchase IS NULL THEN 100
            WHEN days_since_purchase > 180 THEN 90
            WHEN days_since_purchase > 120 THEN 75
            WHEN days_since_purchase > 90 THEN 60
            WHEN days_since_purchase > 60 THEN 40
            WHEN days_since_purchase > 30 THEN 20
            ELSE 10
          END as base_risk_score
        FROM customer_analysis
      ),
      scored_customers AS (
        SELECT 
          *,
          base_risk_score + 
          CASE 
            WHEN frequency_decline > 50 THEN 15
            WHEN frequency_decline > 25 THEN 10
            WHEN frequency_decline > 0 THEN 5
            ELSE 0
          END as risk_score,
          -- Churn probability
          CASE 
            WHEN days_since_purchase IS NULL THEN 95
            WHEN days_since_purchase > 180 THEN 
              LEAST(90, 60 + (days_since_purchase - 180) * 0.1)
            WHEN days_since_purchase > 90 THEN 
              35 + ((days_since_purchase - 90) * 0.25)
            ELSE 
              5 + (days_since_purchase * 0.3)
          END as churn_probability
        FROM risk_calculation
      )
      SELECT 
        client_id,
        client_name,
        risk_score,
        CASE 
          WHEN risk_score >= 80 THEN 'Critical'
          WHEN risk_score >= 60 THEN 'High'
          WHEN risk_score >= 40 THEN 'Medium'
          WHEN risk_score >= 20 THEN 'Low'
          ELSE 'Very Low'
        END as risk_level,
        days_since_purchase,
        frequency_decline as purchase_frequency_decline,
        lifetime_value,
        avg_order_value,
        total_orders,
        last_purchase,
        churn_probability,
        lifetime_value * (churn_probability / 100) as retention_value
      FROM scored_customers
      WHERE risk_score >= 40  -- Only medium risk and above
      ORDER BY risk_score DESC, lifetime_value DESC
      LIMIT 100
    `;

    const customers = await app.prisma.$queryRawUnsafe<IndividualRiskRow[]>(query);

    return customers.map(customer => ({
      client_id: customer.client_id,
      client_name: customer.client_name,
      risk_score: Number(customer.risk_score),
      risk_level: customer.risk_level,
      days_since_last_purchase: Number(customer.days_since_purchase) || 999,
      purchase_frequency_decline: Number(customer.purchase_frequency_decline) || 0,
      lifetime_value: Number(customer.lifetime_value) || 0,
      avg_order_value: Number(customer.avg_order_value) || 0,
      total_orders: Number(customer.total_orders) || 0,
      last_order_date: customer.last_purchase || 'Never',
      churn_probability: Number(customer.churn_probability) || 0,
      risk_factors: this.identifyRiskFactors(customer),
      retention_value: Number(customer.retention_value) || 0
    }));
  }

  private static getPredictiveFactors(): PredictiveFactor[] {
    // These are predefined based on common churn predictors
    // In production, these would be calculated from ML model feature importance
    return [
      {
        factor_name: 'Days Since Last Purchase',
        importance_score: 0.35,
        correlation: 0.78,
        description: 'Number of days since customer last ordered',
        threshold_value: 90
      },
      {
        factor_name: 'Purchase Frequency Decline',
        importance_score: 0.25,
        correlation: 0.65,
        description: 'Decrease in order frequency over last 3 months',
        threshold_value: 50
      },
      {
        factor_name: 'Average Order Value Trend',
        importance_score: 0.15,
        correlation: -0.45,
        description: 'Change in average order value',
        threshold_value: -20
      },
      {
        factor_name: 'Customer Lifetime',
        importance_score: 0.10,
        correlation: -0.30,
        description: 'Total time as active customer',
        threshold_value: 180
      },
      {
        factor_name: 'Product Category Diversity',
        importance_score: 0.08,
        correlation: -0.25,
        description: 'Number of different categories purchased',
        threshold_value: 3
      },
      {
        factor_name: 'Seasonal Pattern Match',
        importance_score: 0.07,
        correlation: -0.20,
        description: 'Deviation from typical seasonal buying pattern',
        threshold_value: 0.7
      }
    ];
  }

  private static async getRetentionOpportunities(app: FastifyInstance): Promise<RetentionOpportunity[]> {
    const query = `
      WITH opportunities AS (
        SELECT 
          'Win-back Campaign' as opportunity_type,
          COUNT(*) FILTER (WHERE days_since_purchase BETWEEN 91 AND 180) as affected_customers,
          SUM(lifetime_value) FILTER (WHERE days_since_purchase BETWEEN 91 AND 180) * 0.3 as potential_save
        FROM (
          SELECT 
            c.client_id,
            EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
            SUM(sp.total_price) as lifetime_value
          FROM clients c
          JOIN sales_partitioned sp ON c.client_id = sp.client_id
          WHERE sp.is_deleted = false
          GROUP BY c.client_id
        ) customer_metrics
        UNION ALL
        SELECT 
          'Loyalty Program' as opportunity_type,
          COUNT(*) FILTER (WHERE total_orders >= 10 AND days_since_purchase <= 60) as affected_customers,
          SUM(lifetime_value) FILTER (WHERE total_orders >= 10 AND days_since_purchase <= 60) * 0.1 as potential_save
        FROM (
          SELECT 
            c.client_id,
            COUNT(DISTINCT sp.sale_datetime::date) as total_orders,
            EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
            SUM(sp.total_price) as lifetime_value
          FROM clients c
          JOIN sales_partitioned sp ON c.client_id = sp.client_id
          WHERE sp.is_deleted = false
          GROUP BY c.client_id
        ) customer_metrics
        UNION ALL
        SELECT 
          'Re-engagement Email' as opportunity_type,
          COUNT(*) FILTER (WHERE days_since_purchase BETWEEN 61 AND 90) as affected_customers,
          SUM(lifetime_value) FILTER (WHERE days_since_purchase BETWEEN 61 AND 90) * 0.4 as potential_save
        FROM (
          SELECT 
            c.client_id,
            EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
            SUM(sp.total_price) as lifetime_value
          FROM clients c
          JOIN sales_partitioned sp ON c.client_id = sp.client_id
          WHERE sp.is_deleted = false
          GROUP BY c.client_id
        ) customer_metrics
      )
      SELECT * FROM opportunities WHERE affected_customers > 0
    `;

    const opportunities = await app.prisma.$queryRawUnsafe<RetentionOpportunityRow[]>(query);

    return opportunities.map(opp => ({
      opportunity_type: opp.opportunity_type,
      affected_customers: Number(opp.affected_customers) || 0,
      potential_revenue_save: Number(opp.potential_save) || 0,
      recommended_action: this.getOpportunityAction(opp.opportunity_type),
      expected_success_rate: this.getExpectedSuccessRate(opp.opportunity_type),
      priority: this.getOpportunityPriority(opp.opportunity_type)
    }));
  }

  private static async getHistoricalChurn(app: FastifyInstance): Promise<ChurnHistory[]> {
    const query = `
      WITH monthly_cohorts AS (
        SELECT 
          TO_CHAR(DATE_TRUNC('month', sp.sale_datetime), 'YYYY-MM') as period,
          COUNT(DISTINCT sp.client_id) as active_customers,
          SUM(sp.total_price) as period_revenue
        FROM sales_partitioned sp
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', sp.sale_datetime)
      ),
      churn_calculation AS (
        SELECT 
          period,
          active_customers,
          period_revenue,
          LAG(active_customers) OVER (ORDER BY period) as previous_customers,
          active_customers - LAG(active_customers) OVER (ORDER BY period) as customer_change
        FROM monthly_cohorts
      )
      SELECT 
        period,
        GREATEST(0, -customer_change) as churned_customers,
        active_customers as retained_customers,
        CASE 
          WHEN previous_customers > 0 THEN 
            (GREATEST(0, -customer_change) * 100.0 / previous_customers)
          ELSE 0 
        END as churn_rate,
        GREATEST(0, customer_change) as recovered_customers,
        period_revenue as revenue_impact
      FROM churn_calculation
      WHERE previous_customers IS NOT NULL
      ORDER BY period
    `;

    const history = await app.prisma.$queryRawUnsafe<HistoricalChurnRow[]>(query);

    return history.map(h => ({
      period: h.period,
      churned_customers: Number(h.churned_customers) || 0,
      retained_customers: Number(h.retained_customers) || 0,
      churn_rate: Number(h.churn_rate) || 0,
      recovered_customers: Number(h.recovered_customers) || 0,
      revenue_impact: Number(h.revenue_impact) || 0
    }));
  }

  private static getKeyIndicators(riskLevel: string): string[] {
    const indicators: { [key: string]: string[] } = {
      'Critical': [
        'No purchase in over 6 months',
        'Significant frequency decline',
        'High lifetime value at risk',
        'No engagement with recent campaigns'
      ],
      'High': [
        'No purchase in 3-6 months',
        'Declining order frequency',
        'Reduced average order value',
        'Lower engagement rates'
      ],
      'Medium': [
        'No purchase in 2-3 months',
        'Slight frequency decline',
        'Seasonal pattern disruption',
        'Decreased product diversity'
      ],
      'Low': [
        'No purchase in 1-2 months',
        'Normal seasonal variation',
        'Stable order patterns',
        'Active engagement'
      ],
      'Very Low': [
        'Recent purchase activity',
        'Consistent ordering pattern',
        'High engagement',
        'Growing order value'
      ]
    };
    return indicators[riskLevel] || [];
  }

  private static getRecommendedActions(riskLevel: string): string[] {
    const actions: { [key: string]: string[] } = {
      'Critical': [
        'Immediate personal outreach',
        'Exclusive win-back offer (30-40% discount)',
        'CEO/founder personal email',
        'Account review and feedback survey'
      ],
      'High': [
        'Targeted win-back campaign',
        'Special loyalty offer (20-25% discount)',
        'Product recommendations based on history',
        'Re-engagement email series'
      ],
      'Medium': [
        'Proactive engagement campaign',
        'Limited-time promotion (15% discount)',
        'New product announcements',
        'Loyalty program invitation'
      ],
      'Low': [
        'Regular newsletter inclusion',
        'Soft touch points',
        'Cross-sell opportunities',
        'Birthday/anniversary offers'
      ],
      'Very Low': [
        'Maintain current engagement',
        'Upsell premium products',
        'Referral program invitation',
        'VIP status consideration'
      ]
    };
    return actions[riskLevel] || [];
  }

  private static getRiskColor(riskLevel: string): string {
    const colors: { [key: string]: string } = {
      'Critical': '#dc2626',
      'High': '#ef4444',
      'Medium': '#f59e0b',
      'Low': '#22c55e',
      'Very Low': '#10b981'
    };
    return colors[riskLevel] || '#6b7280';
  }

  private static identifyRiskFactors(customer: IndividualRiskRow): string[] {
    const factors: string[] = [];
    const daysSincePurchase = Number(customer.days_since_purchase ?? 0);
    const frequencyDecline = Number(customer.purchase_frequency_decline ?? 0);
    const totalOrders = Number(customer.total_orders ?? 0);
    const avgOrderValue = Number(customer.avg_order_value ?? 0);

    if (daysSincePurchase > 180) {
      factors.push('Mucho tiempo desde última compra');
    } else if (daysSincePurchase > 90) {
      factors.push('Intervalo de compra extendido');
    }

    if (frequencyDecline > 50) {
      factors.push('Declive significativo en frecuencia');
    } else if (frequencyDecline > 25) {
      factors.push('Declive moderado en frecuencia');
    }

    if (totalOrders < 3) {
      factors.push('Historial de compras bajo');
    }

    if (avgOrderValue < 100) {
      factors.push('Valor promedio de pedido bajo');
    }

    return factors.length > 0 ? factors : ['Indicadores de riesgo estándar'];
  }

  private static getOpportunityAction(type: string): string {
    const actions: { [key: string]: string } = {
      'Win-back Campaign': 'Lanzar campaña de correos dirigida con código de descuento del 25%',
      'Loyalty Program': 'Inscribir clientes de alto valor en nivel VIP con beneficios exclusivos',
      'Re-engagement Email': 'Enviar recomendaciones personalizadas de productos basadas en historial de compras',
      'Personal Outreach': 'Gerente de cuenta llama a los 50 clientes en riesgo principales',
      'Feedback Survey': 'Enviar encuesta NPS para entender razones de insatisfacción'
    };
    return actions[type] || 'Implementar estrategia de retención dirigida';
  }

  private static getExpectedSuccessRate(type: string): number {
    const rates: { [key: string]: number } = {
      'Win-back Campaign': 35,
      'Loyalty Program': 65,
      'Re-engagement Email': 45,
      'Personal Outreach': 55,
      'Feedback Survey': 25
    };
    return rates[type] || 30;
  }

  private static getOpportunityPriority(type: string): 'High' | 'Medium' | 'Low' {
    const priorities: { [key: string]: 'High' | 'Medium' | 'Low' } = {
      'Win-back Campaign': 'High',
      'Loyalty Program': 'Medium',
      'Re-engagement Email': 'High',
      'Personal Outreach': 'High',
      'Feedback Survey': 'Low'
    };
    return priorities[type] || 'Medium';
  }
}