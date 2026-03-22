import { FastifyInstance } from 'fastify';

interface CustomerSegment {
  segment_name: string;
  customer_count: number;
  avg_order_value: number;
  total_revenue: number;
  avg_recency_days: number;
  avg_frequency: number;
  characteristics: string[];
  recommended_actions: string[];
  color: string;
}

interface CLVBracket {
  bracket: string;
  customer_count: number;
  total_value: number;
  percentage: number;
}

interface RFMCell {
  r_score: number;
  f_score: number;
  m_score: number;
  customer_count: number;
  avg_value: number;
  segment: string;
}

interface ChurnRiskGroup {
  risk_level: string;
  customer_count: number;
  avg_days_since_purchase: number;
  potential_lost_revenue: number;
  recommended_action: string;
}

interface RFMScoresUpdateRow {
  client_id: number;
}

interface SegmentRow {
  segment_name: string;
  customer_count: string | number | null;
  avg_order_value: string | number | null;
  total_revenue: string | number | null;
  avg_recency_days: string | number | null;
  avg_frequency: string | number | null;
}

interface CLVBracketRow {
  bracket: string;
  customer_count: string | number | null;
  total_value: string | number | null;
  percentage: string | number | null;
}

interface RFMCellRow {
  r_score: string | number | null;
  f_score: string | number | null;
  m_score: string | number | null;
  customer_count: string | number | null;
  avg_value: string | number | null;
  segment: string;
}

interface ChurnRiskRow {
  risk_level: string;
  customer_count: string | number | null;
  avg_days_since_purchase: string | number | null;
  potential_lost_revenue: string | number | null;
}

export class CustomerAnalyticsService {
  static async getCustomerSegments(app: FastifyInstance): Promise<CustomerSegment[]> {
    const query = `
      WITH customer_rfm AS (
        SELECT 
          c.client_id,
          c.client_name,
          -- Recency: Days since last purchase
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as recency_days,
          -- Frequency: Number of orders
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          -- Monetary: Total spent
          SUM(sp.total_price) as monetary_value,
          -- Additional metrics
          COUNT(DISTINCT sp.product_id) as unique_products,
          AVG(sp.total_price) as avg_order_value
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '2 years'
        GROUP BY c.client_id, c.client_name
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) AS p80,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) AS p60,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) AS p40,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) AS p20
        FROM customer_rfm
      ),
      rfm_scores AS (
        SELECT 
          *,
          -- Calculate RFM scores (1-5 scale, 5 is best)
          CASE 
            WHEN recency_days <= 30 THEN 5
            WHEN recency_days <= 60 THEN 4
            WHEN recency_days <= 90 THEN 3
            WHEN recency_days <= 180 THEN 2
            ELSE 1
          END as r_score,
          CASE 
            WHEN frequency >= 20 THEN 5
            WHEN frequency >= 10 THEN 4
            WHEN frequency >= 5 THEN 3
            WHEN frequency >= 2 THEN 2
            ELSE 1
          END as f_score,
          CASE 
            WHEN monetary_value >= (SELECT p80 FROM percentiles) THEN 5
            WHEN monetary_value >= (SELECT p60 FROM percentiles) THEN 4
            WHEN monetary_value >= (SELECT p40 FROM percentiles) THEN 3
            WHEN monetary_value >= (SELECT p20 FROM percentiles) THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm
      ),
      segmented AS (
        SELECT 
          *,
          r_score * 100 + f_score * 10 + m_score as rfm_combined,
          CASE 
            WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
            WHEN r_score >= 3 AND f_score >= 4 AND m_score >= 4 THEN 'Loyal Customers'
            WHEN r_score >= 4 AND f_score <= 2 AND m_score >= 3 THEN 'New Customers'
            WHEN r_score >= 3 AND f_score >= 3 AND m_score >= 3 THEN 'Potential Loyalists'
            WHEN r_score <= 2 AND f_score >= 3 AND m_score >= 3 THEN 'At Risk'
            WHEN r_score <= 2 AND f_score >= 4 AND m_score >= 4 THEN 'Cant Lose Them'
            WHEN r_score >= 4 AND f_score <= 2 AND m_score <= 2 THEN 'Promising'
            WHEN r_score <= 2 AND f_score <= 2 AND m_score >= 3 THEN 'Hibernating'
            WHEN r_score <= 2 AND f_score <= 2 AND m_score <= 2 THEN 'Lost'
            ELSE 'Need Attention'
          END as segment_name
        FROM rfm_scores
      )
      SELECT 
        segment_name,
        COUNT(*) as customer_count,
        AVG(avg_order_value) as avg_order_value,
        SUM(monetary_value) as total_revenue,
        AVG(recency_days) as avg_recency_days,
        AVG(frequency) as avg_frequency
      FROM segmented
      GROUP BY segment_name
      ORDER BY COUNT(*) DESC
    `;

    const segments = await app.prisma.$queryRawUnsafe<SegmentRow[]>(query);

    // Add characteristics and recommendations for each segment
    return segments.map(segment => ({
      segment_name: segment.segment_name,
      customer_count: Number(segment.customer_count),
      avg_order_value: Number(segment.avg_order_value),
      total_revenue: Number(segment.total_revenue),
      avg_recency_days: Number(segment.avg_recency_days),
      avg_frequency: Number(segment.avg_frequency),
      characteristics: this.getSegmentCharacteristics(segment.segment_name),
      recommended_actions: this.getSegmentRecommendations(segment.segment_name),
      color: this.getSegmentColor(segment.segment_name)
    }));
  }

  static async getCLVDistribution(app: FastifyInstance): Promise<CLVBracket[]> {
    const query = `
      WITH customer_value AS (
        SELECT 
          client_id,
          SUM(total_price) as lifetime_value
        FROM sales_partitioned
        WHERE is_deleted = false
        GROUP BY client_id
      ),
      brackets AS (
        SELECT 
          CASE 
            WHEN lifetime_value >= 100000 THEN '> Q100K'
            WHEN lifetime_value >= 50000 THEN 'Q50K-Q100K'
            WHEN lifetime_value >= 20000 THEN 'Q20K-Q50K'
            WHEN lifetime_value >= 10000 THEN 'Q10K-Q20K'
            WHEN lifetime_value >= 5000 THEN 'Q5K-Q10K'
            ELSE '< Q5K'
          END as bracket,
          COUNT(*) as customer_count,
          SUM(lifetime_value) as total_value
        FROM customer_value
        GROUP BY 1
      )
      SELECT 
        bracket,
        customer_count,
        total_value,
        ROUND(customer_count * 100.0 / SUM(customer_count) OVER(), 2) as percentage
      FROM brackets
      ORDER BY 
        CASE bracket
          WHEN '> Q100K' THEN 1
          WHEN 'Q50K-Q100K' THEN 2
          WHEN 'Q20K-Q50K' THEN 3
          WHEN 'Q10K-Q20K' THEN 4
          WHEN 'Q5K-Q10K' THEN 5
          ELSE 6
        END
    `;

    const distribution = await app.prisma.$queryRawUnsafe<CLVBracketRow[]>(query);
    
    return distribution.map(bracket => ({
      bracket: bracket.bracket,
      customer_count: Number(bracket.customer_count),
      total_value: Number(bracket.total_value),
      percentage: Number(bracket.percentage)
    }));
  }

  static async getRFMMatrix(app: FastifyInstance): Promise<RFMCell[]> {
    const query = `
      WITH customer_rfm AS (
        SELECT 
          c.client_id,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as recency_days,
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          SUM(sp.total_price) as monetary_value
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '1 year'
        GROUP BY c.client_id
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) AS p80,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) AS p60,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) AS p40,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) AS p20
        FROM customer_rfm
      ),
      rfm_scores AS (
        SELECT 
          *,
          CASE 
            WHEN recency_days <= 30 THEN 5
            WHEN recency_days <= 60 THEN 4
            WHEN recency_days <= 90 THEN 3
            WHEN recency_days <= 180 THEN 2
            ELSE 1
          END as r_score,
          CASE 
            WHEN frequency >= 20 THEN 5
            WHEN frequency >= 10 THEN 4
            WHEN frequency >= 5 THEN 3
            WHEN frequency >= 2 THEN 2
            ELSE 1
          END as f_score,
          CASE 
            WHEN monetary_value >= (SELECT p80 FROM percentiles) THEN 5
            WHEN monetary_value >= (SELECT p60 FROM percentiles) THEN 4
            WHEN monetary_value >= (SELECT p40 FROM percentiles) THEN 3
            WHEN monetary_value >= (SELECT p20 FROM percentiles) THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm
      )
      SELECT 
        r_score,
        f_score,
        m_score,
        COUNT(*) as customer_count,
        AVG(monetary_value) as avg_value,
        CASE 
          WHEN r_score >= 4 AND f_score >= 4 THEN 'Champions'
          WHEN r_score >= 3 AND f_score >= 3 THEN 'Loyal'
          WHEN r_score >= 4 AND f_score <= 2 THEN 'New'
          WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
          ELSE 'Other'
        END as segment
      FROM rfm_scores
      GROUP BY r_score, f_score, m_score
      ORDER BY r_score DESC, f_score DESC, m_score DESC
    `;

    const matrix = await app.prisma.$queryRawUnsafe<RFMCellRow[]>(query);
    
    return matrix.map(cell => ({
      r_score: Number(cell.r_score),
      f_score: Number(cell.f_score),
      m_score: Number(cell.m_score),
      customer_count: Number(cell.customer_count),
      avg_value: Number(cell.avg_value),
      segment: cell.segment
    }));
  }

  static async getChurnRiskAnalysis(app: FastifyInstance): Promise<ChurnRiskGroup[]> {
    const query = `
      WITH customer_activity AS (
        SELECT 
          c.client_id,
          MAX(sp.sale_datetime) as last_purchase,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as days_since_purchase,
          AVG(sp.total_price) as avg_order_value,
          COUNT(DISTINCT sp.sale_datetime::date) as total_orders
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
        GROUP BY c.client_id
      ),
      risk_groups AS (
        SELECT 
          CASE 
            WHEN days_since_purchase <= 30 THEN 'Active'
            WHEN days_since_purchase <= 60 THEN 'Low Risk'
            WHEN days_since_purchase <= 90 THEN 'Medium Risk'
            WHEN days_since_purchase <= 180 THEN 'High Risk'
            ELSE 'Lost'
          END as risk_level,
          COUNT(*) as customer_count,
          AVG(days_since_purchase) as avg_days_since_purchase,
          SUM(avg_order_value * 12) as potential_lost_revenue -- Annualized
        FROM customer_activity
        GROUP BY 1
      )
      SELECT * FROM risk_groups
      ORDER BY 
        CASE risk_level
          WHEN 'Active' THEN 1
          WHEN 'Low Risk' THEN 2
          WHEN 'Medium Risk' THEN 3
          WHEN 'High Risk' THEN 4
          ELSE 5
        END
    `;

    const riskGroups = await app.prisma.$queryRawUnsafe<ChurnRiskRow[]>(query);
    
    return riskGroups.map(group => ({
      risk_level: group.risk_level,
      customer_count: Number(group.customer_count),
      avg_days_since_purchase: Number(group.avg_days_since_purchase),
      potential_lost_revenue: Number(group.potential_lost_revenue),
      recommended_action: this.getChurnAction(group.risk_level)
    }));
  }

  static async calculateRFMScores(app: FastifyInstance): Promise<{ updated: number }> {
    const updateQuery = `
      WITH customer_rfm AS (
        SELECT 
          c.client_id,
          EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)) as recency_days,
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          SUM(sp.total_price) as monetary_value
        FROM clients c
        JOIN sales_partitioned sp ON c.client_id = sp.client_id
        WHERE sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '2 years'
        GROUP BY c.client_id
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) AS p80,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) AS p60,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) AS p40,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) AS p20
        FROM customer_rfm
      ),
      rfm_scores AS (
        SELECT 
          client_id,
          recency_days,
          frequency,
          monetary_value,
          CASE 
            WHEN recency_days <= 30 THEN 5
            WHEN recency_days <= 60 THEN 4
            WHEN recency_days <= 90 THEN 3
            WHEN recency_days <= 180 THEN 2
            ELSE 1
          END as r_score,
          CASE 
            WHEN frequency >= 20 THEN 5
            WHEN frequency >= 10 THEN 4
            WHEN frequency >= 5 THEN 3
            WHEN frequency >= 2 THEN 2
            ELSE 1
          END as f_score,
          CASE 
            WHEN monetary_value >= (SELECT p80 FROM percentiles) THEN 5
            WHEN monetary_value >= (SELECT p60 FROM percentiles) THEN 4
            WHEN monetary_value >= (SELECT p40 FROM percentiles) THEN 3
            WHEN monetary_value >= (SELECT p20 FROM percentiles) THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm
      )
      UPDATE clients c
      SET 
        rfm_recency = rs.r_score,
        rfm_frequency = rs.f_score,
        rfm_monetary = rs.m_score,
        rfm_score = rs.r_score * 100 + rs.f_score * 10 + rs.m_score,
        total_orders = rs.frequency,
        total_spent = rs.monetary_value,
        avg_order_value = rs.monetary_value / NULLIF(rs.frequency, 0),
        last_purchase_date = NOW() - (rs.recency_days || ' days')::interval,
        segment = CASE 
          WHEN rs.r_score >= 4 AND rs.f_score >= 4 AND rs.m_score >= 4 THEN 'Champions'
          WHEN rs.r_score >= 3 AND rs.f_score >= 4 AND rs.m_score >= 4 THEN 'Loyal Customers'
          WHEN rs.r_score >= 4 AND rs.f_score <= 2 AND rs.m_score >= 3 THEN 'New Customers'
          WHEN rs.r_score >= 3 AND rs.f_score >= 3 AND rs.m_score >= 3 THEN 'Potential Loyalists'
          WHEN rs.r_score <= 2 AND rs.f_score >= 3 AND rs.m_score >= 3 THEN 'At Risk'
          WHEN rs.r_score <= 2 AND rs.f_score >= 4 AND rs.m_score >= 4 THEN 'Cant Lose Them'
          WHEN rs.r_score >= 4 AND rs.f_score <= 2 AND rs.m_score <= 2 THEN 'Promising'
          WHEN rs.r_score <= 2 AND rs.f_score <= 2 AND rs.m_score >= 3 THEN 'Hibernating'
          WHEN rs.r_score <= 2 AND rs.f_score <= 2 AND rs.m_score <= 2 THEN 'Lost'
          ELSE 'Need Attention'
        END,
        last_updated = NOW()
      FROM rfm_scores rs
      WHERE c.client_id = rs.client_id
      RETURNING c.client_id
    `;

    const result = await app.prisma.$queryRawUnsafe<RFMScoresUpdateRow[]>(updateQuery);
    
    return { updated: result.length };
  }

  private static getSegmentCharacteristics(segment: string): string[] {
    const characteristics: { [key: string]: string[] } = {
      'Champions': ['Mejores clientes', 'Compran frecuentemente', 'Alto gasto', 'Compras recientes'],
      'Loyal Customers': ['Compradores regulares', 'Responden a promociones', 'Gasto superior al promedio'],
      'New Customers': ['Adquiridos recientemente', 'Baja frecuencia', 'Potencial de crecimiento'],
      'Potential Loyalists': ['Clientes recientes', 'Frecuencia moderada', 'Gasto promedio'],
      'At Risk': ['No han comprado recientemente', 'Compraban frecuentemente', 'Requieren reactivación'],
      'Cant Lose Them': ['Clientes de alto valor', 'No han comprado recientemente', 'Crítico retener'],
      'Promising': ['Compradores recientes', 'Baja frecuencia', 'Bajo gasto'],
      'Hibernating': ['Baja participación', 'Bajo gasto', 'Mucho tiempo desde última compra'],
      'Lost': ['No han comprado en mucho tiempo', 'Bajo valor histórico', 'Poco probable que regresen'],
      'Need Attention': ['Por debajo del promedio en métricas', 'Oportunidad de mejora']
    };
    
    return characteristics[segment] || ['Requiere análisis'];
  }

  private static getSegmentRecommendations(segment: string): string[] {
    const recommendations: { [key: string]: string[] } = {
      'Champions': ['Premiar con programa VIP', 'Acceso anticipado a productos nuevos', 'Solicitar referidos'],
      'Loyal Customers': ['Vender productos de mayor valor', 'Solicitar reseñas', 'Participar en programa de lealtad'],
      'New Customers': ['Proporcionar soporte de incorporación', 'Ofrecer ofertas iniciales', 'Crear conciencia de marca'],
      'Potential Loyalists': ['Ofrecer programa de membresía', 'Recomendar productos relacionados', 'Proporcionar envío gratis'],
      'At Risk': ['Enviar campaña de reactivación', 'Ofrecer descuentos especiales', 'Solicitar retroalimentación'],
      'Cant Lose Them': ['Acercamiento personal', 'Ofertas exclusivas', 'Campaña de recuperación'],
      'Promising': ['Cultivar con contenido', 'Vender productos complementarios', 'Construir relación'],
      'Hibernating': ['Campaña de reactivación', 'Encuesta para retroalimentación', 'Oferta especial de regreso'],
      'Lost': ['Último intento de recuperación', 'Remover de campañas activas', 'Analizar por qué se fueron'],
      'Need Attention': ['Por debajo del promedio en métricas', 'Oportunidad de mejora']
    };

    return recommendations[segment] || ['Requiere análisis'];
  }

  private static getSegmentColor(segment: string): string {
    const colors: { [key: string]: string } = {
      'Champions': '#16a34a',
      'Loyal Customers': '#22c55e',
      'New Customers': '#3b82f6',
      'Potential Loyalists': '#06b6d4',
      'At Risk': '#f59e0b',
      'Cant Lose Them': '#ef4444',
      'Promising': '#8b5cf6',
      'Hibernating': '#64748b',
      'Lost': '#475569',
      'Need Attention': '#d97706'
    };
    return colors[segment] || '#94a3b8';
  }

  private static getChurnAction(riskLevel: string): string {
    const actions: { [key: string]: string } = {
      'Active': 'Mantener participación con actualizaciones y recompensas regulares',
      'Low Risk': 'Ofrecer recomendaciones personalizadas para aumentar frecuencia',
      'Medium Risk': 'Enviar campaña dirigida de reconexión con incentivos',
      'High Risk': 'Iniciar ofertas de recuperación y encuesta para retroalimentación',
      'Lost': 'Ejecutar campaña final de recuperación; analizar razones de abandono'
    };
    return actions[riskLevel] || 'Monitorear y adaptar estrategia de participación';
  }
}