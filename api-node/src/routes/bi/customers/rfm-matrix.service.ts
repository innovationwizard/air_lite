import { FastifyInstance } from 'fastify';

interface RFMMatrixResponse {
  matrix: RFMCell[][];
  distribution: RFMDistribution;
  segments: RFMSegment[];
  statistics: RFMStatistics;
}

interface RFMCell {
  r_score: number;
  f_score: number;
  m_score: number;
  customer_count: number;
  customer_ids: number[];
  total_value: number;
  avg_value: number;
  segment: string;
  color: string;
  intensity: number;
}

interface RFMDistribution {
  recency: ScoreDistribution[];
  frequency: ScoreDistribution[];
  monetary: ScoreDistribution[];
}

interface ScoreDistribution {
  score: number;
  count: number;
  percentage: number;
  label: string;
}

interface RFMSegment {
  segment_name: string;
  rfm_pattern: string;
  customer_count: number;
  total_value: number;
  avg_recency_days: number;
  avg_frequency: number;
  avg_monetary: number;
  percentage: number;
  color: string;
  description: string;
  action_items: string[];
}

interface RFMStatistics {
  total_customers: number;
  avg_rfm_score: number;
  highest_value_cell: string;
  most_populated_cell: string;
  at_risk_percentage: number;
  champion_percentage: number;
}

interface RFMCellRow {
  r_score: string | number;
  f_score: string | number;
  m_score: string | number;
  customer_count: string | number;
  customer_ids: number[];
  total_value: string | number;
  avg_value: string | number;
  avg_recency: string | number;
  avg_frequency: string | number;
  avg_monetary: string | number;
}

interface RFMDistributionRow {
  dimension: 'recency' | 'frequency' | 'monetary';
  score: string | number;
  count: string | number;
  percentage: string | number;
}

interface RFMSegmentRow {
  segment_name: string;
  rfm_pattern: string;
  customer_count: string | number;
  total_value: string | number;
  avg_recency_days: string | number;
  avg_frequency: string | number;
  avg_monetary: string | number;
  percentage: string | number;
}

export class RFMMatrixService {
  static async getRFMMatrix(app: FastifyInstance): Promise<RFMMatrixResponse> {
    // Get RFM scores for all customers
    const rfmQuery = `
      WITH customer_rfm_base AS (
        SELECT 
          c.client_id,
          c.client_name,
          -- Recency: Days since last purchase
          COALESCE(EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)), 999) as recency_days,
          -- Frequency: Number of orders
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          -- Monetary: Total spent
          COALESCE(SUM(sp.total_price), 0) as monetary_value
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '2 years'
        GROUP BY c.client_id, c.client_name
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY recency_days DESC) as r_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY recency_days DESC) as r_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY recency_days DESC) as r_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY recency_days DESC) as r_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency) as f_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency) as f_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency) as f_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency) as f_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) as m_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) as m_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) as m_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) as m_80
        FROM customer_rfm_base
      ),
      rfm_scores AS (
        SELECT 
          crb.*,
          -- Recency score (inverted - lower is better)
          CASE 
            WHEN recency_days <= p.r_20 THEN 5
            WHEN recency_days <= p.r_40 THEN 4
            WHEN recency_days <= p.r_60 THEN 3
            WHEN recency_days <= p.r_80 THEN 2
            ELSE 1
          END as r_score,
          -- Frequency score
          CASE 
            WHEN frequency >= p.f_80 THEN 5
            WHEN frequency >= p.f_60 THEN 4
            WHEN frequency >= p.f_40 THEN 3
            WHEN frequency >= p.f_20 THEN 2
            ELSE 1
          END as f_score,
          -- Monetary score
          CASE 
            WHEN monetary_value >= p.m_80 THEN 5
            WHEN monetary_value >= p.m_60 THEN 4
            WHEN monetary_value >= p.m_40 THEN 3
            WHEN monetary_value >= p.m_20 THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm_base crb
        CROSS JOIN percentiles p
      )
      SELECT 
        r_score,
        f_score,
        m_score,
        COUNT(*) as customer_count,
        array_agg(client_id) as customer_ids,
        SUM(monetary_value) as total_value,
        AVG(monetary_value) as avg_value,
        AVG(recency_days) as avg_recency,
        AVG(frequency) as avg_frequency,
        AVG(monetary_value) as avg_monetary
      FROM rfm_scores
      GROUP BY r_score, f_score, m_score
    `;

    const rfmCells = await app.prisma.$queryRawUnsafe<RFMCellRow[]>(rfmQuery);

    // Build 5x5x5 matrix
    const matrix = this.buildMatrix(rfmCells);

    // Get distribution for each dimension
    const distribution = await this.getRFMDistribution(app);

    // Get segment analysis
    const segments = await this.getSegmentAnalysis(app);

    // Calculate statistics
    const statistics = this.calculateStatistics(rfmCells);

    return {
      matrix,
      distribution,
      segments,
      statistics
    };
  }

  private static buildMatrix(cells: RFMCellRow[]): RFMCell[][] {
    // Initialize 5x5 matrix (flattening M by storing best cell per R/F)
    const matrix: Array<Array<RFMCell | null>> = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => null)
    );

    // Process cells
    cells.forEach(cell => {
      const rIndex = 5 - Number(cell.r_score); // Invert for display (5 at top)
      const fIndex = Number(cell.f_score) - 1;
      
      // Average M scores for 2D visualization
      const avgMScore = Number(cell.m_score);
      
      // Determine segment
      const segment = this.getSegmentName(
        Number(cell.r_score),
        Number(cell.f_score),
        avgMScore
      );

      // Calculate intensity for heatmap
      const maxCustomers = Math.max(...cells.map(c => Number(c.customer_count)));
      const intensity = Number(cell.customer_count) / maxCustomers;

      if (!matrix[rIndex][fIndex] || Number(cell.customer_count) > matrix[rIndex][fIndex].customer_count) {
        matrix[rIndex][fIndex] = {
          r_score: Number(cell.r_score),
          f_score: Number(cell.f_score),
          m_score: avgMScore,
          customer_count: Number(cell.customer_count),
          customer_ids: cell.customer_ids.slice(0, 10), // Limit to 10 IDs
          total_value: Number(cell.total_value),
          avg_value: Number(cell.avg_value),
          segment,
          color: this.getSegmentColor(segment),
          intensity
        };
      }
    });

    // Fill empty cells
    for (let r = 0; r < 5; r++) {
      for (let f = 0; f < 5; f++) {
        if (!matrix[r][f]) {
          matrix[r][f] = {
            r_score: 5 - r,
            f_score: f + 1,
            m_score: 3, // Default middle score
            customer_count: 0,
            customer_ids: [],
            total_value: 0,
            avg_value: 0,
            segment: 'Empty',
            color: '#f3f4f6',
            intensity: 0
          };
        }
      }
    }

    return matrix as RFMCell[][];
  }

  private static async getRFMDistribution(app: FastifyInstance): Promise<RFMDistribution> {
    const distributionQuery = `
      WITH customer_rfm AS (
        SELECT 
          c.client_id,
          COALESCE(EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)), 999) as recency_days,
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          COALESCE(SUM(sp.total_price), 0) as monetary_value
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '2 years'
        GROUP BY c.client_id
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY recency_days DESC) as r_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY recency_days DESC) as r_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY recency_days DESC) as r_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY recency_days DESC) as r_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency) as f_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency) as f_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency) as f_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency) as f_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) as m_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) as m_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) as m_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) as m_80
        FROM customer_rfm
      ),
      rfm_scores AS (
        SELECT 
          CASE 
            WHEN recency_days <= p.r_20 THEN 5
            WHEN recency_days <= p.r_40 THEN 4
            WHEN recency_days <= p.r_60 THEN 3
            WHEN recency_days <= p.r_80 THEN 2
            ELSE 1
          END as r_score,
          CASE 
            WHEN frequency >= p.f_80 THEN 5
            WHEN frequency >= p.f_60 THEN 4
            WHEN frequency >= p.f_40 THEN 3
            WHEN frequency >= p.f_20 THEN 2
            ELSE 1
          END as f_score,
          CASE 
            WHEN monetary_value >= p.m_80 THEN 5
            WHEN monetary_value >= p.m_60 THEN 4
            WHEN monetary_value >= p.m_40 THEN 3
            WHEN monetary_value >= p.m_20 THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm
        CROSS JOIN percentiles p
      ),
      distributions AS (
        SELECT 
          'recency' as dimension,
          r_score as score,
          COUNT(*) as count
        FROM rfm_scores
        GROUP BY r_score
        UNION ALL
        SELECT 
          'frequency' as dimension,
          f_score as score,
          COUNT(*) as count
        FROM rfm_scores
        GROUP BY f_score
        UNION ALL
        SELECT 
          'monetary' as dimension,
          m_score as score,
          COUNT(*) as count
        FROM rfm_scores
        GROUP BY m_score
      )
      SELECT 
        dimension,
        score,
        count,
        ROUND(100.0 * count / SUM(count) OVER (PARTITION BY dimension), 2) as percentage
      FROM distributions
      ORDER BY dimension, score
    `;

    const rows = await app.prisma.$queryRawUnsafe<RFMDistributionRow[]>(distributionQuery);

    const distribution: RFMDistribution = {
      recency: [],
      frequency: [],
      monetary: []
    };

    rows.forEach(row => {
      const item: ScoreDistribution = {
        score: Number(row.score),
        count: Number(row.count),
        percentage: Number(row.percentage),
        label: this.getScoreLabel(row.dimension, Number(row.score))
      };

      if (row.dimension === 'recency') distribution.recency.push(item);
      else if (row.dimension === 'frequency') distribution.frequency.push(item);
      else if (row.dimension === 'monetary') distribution.monetary.push(item);
    });

    return distribution;
  }

  private static async getSegmentAnalysis(app: FastifyInstance): Promise<RFMSegment[]> {
    const segmentQuery = `
      WITH customer_rfm AS (
        SELECT 
          c.client_id,
          COALESCE(EXTRACT(DAY FROM NOW() - MAX(sp.sale_datetime)), 999) as recency_days,
          COUNT(DISTINCT sp.sale_datetime::date) as frequency,
          COALESCE(SUM(sp.total_price), 0) as monetary_value
        FROM clients c
        LEFT JOIN sales_partitioned sp ON c.client_id = sp.client_id
          AND sp.is_deleted = false
          AND sp.sale_datetime >= NOW() - INTERVAL '2 years'
        GROUP BY c.client_id
      ),
      percentiles AS (
        SELECT 
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY recency_days DESC) as r_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY recency_days DESC) as r_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY recency_days DESC) as r_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY recency_days DESC) as r_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency) as f_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency) as f_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency) as f_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency) as f_80,
          PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary_value) as m_20,
          PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary_value) as m_40,
          PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary_value) as m_60,
          PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary_value) as m_80
        FROM customer_rfm
      ),
      rfm_scores AS (
        SELECT 
          *,
          CASE 
            WHEN recency_days <= p.r_20 THEN 5
            WHEN recency_days <= p.r_40 THEN 4
            WHEN recency_days <= p.r_60 THEN 3
            WHEN recency_days <= p.r_80 THEN 2
            ELSE 1
          END as r_score,
          CASE 
            WHEN frequency >= p.f_80 THEN 5
            WHEN frequency >= p.f_60 THEN 4
            WHEN frequency >= p.f_40 THEN 3
            WHEN frequency >= p.f_20 THEN 2
            ELSE 1
          END as f_score,
          CASE 
            WHEN monetary_value >= p.m_80 THEN 5
            WHEN monetary_value >= p.m_60 THEN 4
            WHEN monetary_value >= p.m_40 THEN 3
            WHEN monetary_value >= p.m_20 THEN 2
            ELSE 1
          END as m_score
        FROM customer_rfm
        CROSS JOIN percentiles p
      ),
      segmented AS (
        SELECT 
          *,
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
          END as segment_name,
          r_score::text || f_score::text || m_score::text as rfm_pattern
        FROM rfm_scores
      )
      SELECT 
        segment_name,
        STRING_AGG(DISTINCT rfm_pattern, ', ') as rfm_pattern,
        COUNT(*) as customer_count,
        SUM(monetary_value) as total_value,
        AVG(recency_days) as avg_recency_days,
        AVG(frequency) as avg_frequency,
        AVG(monetary_value) as avg_monetary,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) as percentage
      FROM segmented
      GROUP BY segment_name
      ORDER BY COUNT(*) DESC
    `;

    const segments = await app.prisma.$queryRawUnsafe<RFMSegmentRow[]>(segmentQuery);

    return segments.map(segment => ({
      segment_name: segment.segment_name,
      rfm_pattern: segment.rfm_pattern,
      customer_count: Number(segment.customer_count),
      total_value: Number(segment.total_value),
      avg_recency_days: Number(segment.avg_recency_days),
      avg_frequency: Number(segment.avg_frequency),
      avg_monetary: Number(segment.avg_monetary),
      percentage: Number(segment.percentage),
      color: this.getSegmentColor(segment.segment_name),
      description: this.getSegmentDescription(segment.segment_name),
      action_items: this.getSegmentActions(segment.segment_name)
    }));
  }

  private static calculateStatistics(cells: RFMCellRow[]): RFMStatistics {
    const totalCustomers = cells.reduce((sum, cell) => sum + Number(cell.customer_count), 0);
    
    const avgRFMScore = cells.reduce((sum, cell) => {
      const score = Number(cell.r_score) * 100 + Number(cell.f_score) * 10 + Number(cell.m_score);
      return sum + (score * Number(cell.customer_count));
    }, 0) / totalCustomers;

    const highestValueCell = cells.reduce((max, cell) => 
      Number(cell.total_value) > Number(max.total_value) ? cell : max
    );

    const mostPopulatedCell = cells.reduce((max, cell) => 
      Number(cell.customer_count) > Number(max.customer_count) ? cell : max
    );

    const atRiskCount = cells
      .filter(cell => Number(cell.r_score) <= 2 && Number(cell.f_score) >= 3)
      .reduce((sum, cell) => sum + Number(cell.customer_count), 0);

    const championCount = cells
      .filter(cell => Number(cell.r_score) >= 4 && Number(cell.f_score) >= 4 && Number(cell.m_score) >= 4)
      .reduce((sum, cell) => sum + Number(cell.customer_count), 0);

    return {
      total_customers: totalCustomers,
      avg_rfm_score: avgRFMScore,
      highest_value_cell: `R${highestValueCell.r_score}F${highestValueCell.f_score}M${highestValueCell.m_score}`,
      most_populated_cell: `R${mostPopulatedCell.r_score}F${mostPopulatedCell.f_score}M${mostPopulatedCell.m_score}`,
      at_risk_percentage: (atRiskCount / totalCustomers) * 100,
      champion_percentage: (championCount / totalCustomers) * 100
    };
  }

  private static getSegmentName(r: number, f: number, m: number): string {
    if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
    if (r >= 3 && f >= 4 && m >= 4) return 'Loyal Customers';
    if (r >= 4 && f <= 2 && m >= 3) return 'New Customers';
    if (r >= 3 && f >= 3 && m >= 3) return 'Potential Loyalists';
    if (r <= 2 && f >= 3 && m >= 3) return 'At Risk';
    if (r <= 2 && f >= 4 && m >= 4) return 'Cant Lose Them';
    if (r >= 4 && f <= 2 && m <= 2) return 'Promising';
    if (r <= 2 && f <= 2 && m >= 3) return 'Hibernating';
    if (r <= 2 && f <= 2 && m <= 2) return 'Lost';
    return 'Need Attention';
  }

  private static getSegmentColor(segment: string): string {
    const colors: { [key: string]: string } = {
      'Champions': '#10b981',
      'Loyal Customers': '#22c55e',
      'New Customers': '#3b82f6',
      'Potential Loyalists': '#60a5fa',
      'At Risk': '#f59e0b',
      'Cant Lose Them': '#ef4444',
      'Promising': '#8b5cf6',
      'Hibernating': '#64748b',
      'Lost': '#6b7280',
      'Need Attention': '#eab308',
      'Empty': '#f3f4f6'
    };
    return colors[segment] || '#94a3b8';
  }

  private static getScoreLabel(dimension: string, score: number): string {
    if (dimension === 'recency') {
      const labels = ['Muy Antiguo', 'Antiguo', 'Medio', 'Reciente', 'Muy Reciente'];
      return labels[score - 1] || 'Desconocido';
    }
    if (dimension === 'frequency') {
      const labels = ['Muy Baja', 'Baja', 'Media', 'Alta', 'Muy Alta'];
      return labels[score - 1] || 'Desconocido';
    }
    if (dimension === 'monetary') {
      const labels = ['Muy Bajo', 'Bajo', 'Medio', 'Alto', 'Muy Alto'];
      return labels[score - 1] || 'Desconocido';
    }
    return 'Desconocido';
  }

  private static getSegmentDescription(segment: string): string {
    const descriptions: { [key: string]: string } = {
      'Champions': 'Mejores clientes que compran frecuentemente, recientemente, y gastan más',
      'Loyal Customers': 'Clientes que compran regularmente y responden a promociones',
      'New Customers': 'Clientes adquiridos recientemente con potencial de crecimiento',
      'Potential Loyalists': 'Clientes recientes con frecuencia y gasto moderados',
      'At Risk': 'Clientes anteriormente buenos que no han comprado recientemente',
      'Cant Lose Them': 'Clientes de alto valor en riesgo de abandono',
      'Promising': 'Clientes nuevos mostrando interés inicial',
      'Hibernating': 'Clientes inactivos con baja participación',
      'Lost': 'Clientes poco probable que regresen',
      'Need Attention': 'Clientes que requieren participación dirigida'
    };
    return descriptions[segment] || 'Requiere análisis';
  }

  private static getSegmentActions(segment: string): string[] {
    const actions: { [key: string]: string[] } = {
      'Champions': [
        'Crear programa de lealtad VIP',
        'Ofrecer acceso anticipado a productos nuevos',
        'Solicitar referidos y reseñas',
        'Proporcionar beneficios exclusivos'
      ],
      'Loyal Customers': [
        'Vender productos premium',
        'Aumentar frecuencia de participación',
        'Premiar con puntos de lealtad',
        'Vender productos complementarios'
      ],
      'New Customers': [
        'Serie de correos de bienvenida',
        'Descuento en primera compra',
        'Contenido educativo de productos',
        'Soporte de incorporación'
      ],
      'Potential Loyalists': [
        'Recomendaciones personalizadas de productos',
        'Ofertas de envío gratis',
        'Invitación a programa de lealtad',
        'Campañas de participación'
      ],
      'At Risk': [
        'Campaña de recuperación',
        'Oferta de descuento especial',
        'Encuesta para retroalimentación',
        'Serie de correos de reconexión'
      ],
      'Cant Lose Them': [
        'Gerente de cuenta personal',
        'Oferta de retención exclusiva',
        'Acercamiento telefónico directo',
        'Soporte premium'
      ],
      'Promising': [
        'Campaña de correos de cultivo',
        'Recomendaciones de productos',
        'Contenido educativo',
        'Incentivos pequeños'
      ],
      'Hibernating': [
        'Campaña de reactivación',
        'Oferta de descuento profundo',
        'Solicitud de actualización de preferencias',
        'Actualizaciones de noticias de productos'
      ],
      'Lost': [
        'Último intento de recuperación',
        'Encuesta de retroalimentación',
        'Remover de campañas activas',
        'Analizar razones de abandono'
      ],
      'Need Attention': [
        'Campañas segmentadas',
        'Pruebas A/B',
        'Análisis de comportamiento',
        'Estrategia de participación personalizada'
      ]
    };
    return actions[segment] || ['Analizar comportamiento del cliente'];
  }
}