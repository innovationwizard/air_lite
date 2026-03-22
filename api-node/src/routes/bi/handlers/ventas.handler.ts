// api-node/src/routes/bi/handlers/ventas.handler.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ForecastingQueries } from '../queries/forecasting.queries';

interface ProductForecastParams {
  fechaInicio?: string;
  fechaFin?: string;
  limit?: number;
}

interface RFMParams {
  fechaInicio?: string;
  fechaFin?: string;
  lookbackDays?: number;
}

interface CrossSellParams {
  fechaInicio?: string;
  fechaFin?: string;
  minSupport?: number;
  limit?: number;
}

type ForecastAccuracyMetrics = Awaited<ReturnType<typeof ForecastingQueries.getForecastAccuracyMetrics>>;

interface ForecastSummary {
  total_products: number;
  products_at_risk: number;
  high_confidence_forecasts: number;
  total_forecast_demand: number;
  avg_confidence: number;
}

interface RFMCustomer {
  client_id: number;
  client_name: string;
  segment: string;
  recency_days: number;
  frequency: number;
  monetary_value: number;
  avg_order_value: number;
  purchase_days: number;
  last_purchase_date: string;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_total_score: number;
  recommended_action: string;
  value_tier: string;
}

interface SegmentSummaryEntry {
  segment: string;
  count: number;
  revenue: number;
  avg_value: number;
  percentage: number;
}

interface RFMAnalysisSummary {
  total_customers: number;
  segments: SegmentSummaryEntry[];
  value_at_risk: number;
  champions_count: number;
  at_risk_count: number;
  lost_count: number;
  avg_customer_value: number;
}

interface CrossSellOpportunity {
  product_a_id: number;
  product_a_sku: string;
  product_a_name: string;
  product_a_category: string;
  product_a_price: number;
  product_b_id: number;
  product_b_sku: string;
  product_b_name: string;
  product_b_category: string;
  product_b_price: number;
  co_purchase_count: number;
  product_a_buyers: number;
  product_b_buyers: number;
  lift: number;
  confidence_a_to_b: number;
  confidence_b_to_a: number;
  bundle_revenue_realized: number;
  estimated_bundle_uplift: number;
  suggested_bundle_price: number;
  recommendation_strength: string;
  recommended_action: string;
}

interface CrossSellSummary {
  total_opportunities: number;
  strong_opportunities: number;
  total_estimated_uplift: number;
  avg_lift: number;
  date_range: string;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class VentasHandler {
  /**
   * Product Demand Forecasts - ML-powered 30-day forecast per product
   * Uses existing ForecastingQueries.getProductForecasts()
   */
  static async getProductForecasts(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { fechaInicio, fechaFin, limit = 20 } = request.query as ProductForecastParams;
      const prisma = request.server.prisma;

      const startDate = fechaInicio ? new Date(fechaInicio) : undefined;
      const endDate = fechaFin ? new Date(fechaFin) : undefined;

      // Get ML forecasts from existing query
      const forecasts = await ForecastingQueries.getProductForecasts(
        request.server,
        startDate,
        endDate,
        Number(limit)
      );

      // Get accuracy metrics
      const accuracy = await ForecastingQueries.getForecastAccuracyMetrics(request.server);

      // Calculate summary
      const summary: ForecastSummary = {
        total_products: forecasts.length,
        products_at_risk: forecasts.filter(f => f.days_until_stockout < 14).length,
        high_confidence_forecasts: forecasts.filter(f => f.confidence_score >= 0.85).length,
        total_forecast_demand: forecasts.reduce((sum, f) => sum + f.forecast_30d, 0),
        avg_confidence: forecasts.length > 0
          ? forecasts.reduce((sum, f) => sum + f.confidence_score, 0) / forecasts.length
          : 0,
      };

      // Add narrative
      const narrative = this.generateForecastNarrative(forecasts, summary, accuracy);

      return reply.code(200).send({
        success: true,
        data: {
          summary,
          forecasts,
          accuracy,
          narrative,
          methodology: {
            description: 'Pronóstico basado en análisis de tendencia histórica (90 días) con ajuste estacional',
            formula: 'Forecast_30d = Demanda_Diaria_Promedio × 30 × Factor_Tendencia × Factor_Estacional',
            confidence_calculation: 'Confidence = Calidad_Datos × (1 - Volatilidad_Demanda)',
            data_requirement: 'Mínimo 14 días de historial de ventas',
          },
        },
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, '[VENTAS HANDLER] Error in getProductForecasts:');
      return reply.code(500).send({
        success: false,
        message: 'Error al generar pronósticos de demanda',
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * RFM Customer Segmentation - AI-powered customer value analysis
   */
  static async getRFMAnalysis(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { fechaInicio, fechaFin, lookbackDays = 365 } = request.query as RFMParams;
      const prisma = request.server.prisma;

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();

      // RFM Analysis Query
      const rfmQuery = `
        WITH customer_metrics AS (
          SELECT 
            s.client_id,
            COALESCE(c.client_name, CONCAT('Cliente ', s.client_id)) as client_name,
            MAX(s.sale_datetime) as last_purchase_date,
            EXTRACT(days FROM (CURRENT_DATE - MAX(s.sale_datetime))) as recency_days,
            COUNT(DISTINCT s.sale_id) as frequency,
            SUM(s.total_price) as monetary_value,
            AVG(s.total_price) as avg_order_value,
            COUNT(DISTINCT DATE(s.sale_datetime)) as purchase_days
          FROM sales_partitioned s
          LEFT JOIN clients c ON s.client_id = c.client_id AND c.is_deleted = false
          WHERE s.sale_datetime >= $1 
            AND s.sale_datetime < $2 + INTERVAL '1 day'
            AND s.is_deleted = false
          GROUP BY s.client_id, c.client_name
          HAVING COUNT(DISTINCT s.sale_id) > 0
        ),
        rfm_scores AS (
          SELECT 
            client_id,
            client_name,
            recency_days,
            frequency,
            monetary_value,
            avg_order_value,
            purchase_days,
            last_purchase_date,
            -- RFM Scoring using NTILE (1-5 scale, 5 is best)
            6 - NTILE(5) OVER (ORDER BY recency_days) as r_score,
            NTILE(5) OVER (ORDER BY frequency) as f_score,
            NTILE(5) OVER (ORDER BY monetary_value) as m_score
          FROM customer_metrics
        ),
        rfm_segments AS (
          SELECT 
            *,
            -- Segment classification
            CASE 
              WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
              WHEN r_score >= 3 AND f_score >= 3 AND m_score >= 3 THEN 'Loyal Customers'
              WHEN r_score >= 4 AND f_score <= 2 THEN 'Promising'
              WHEN r_score <= 2 AND f_score >= 4 THEN 'At Risk'
              WHEN r_score <= 2 AND f_score <= 2 AND m_score >= 4 THEN 'Cant Lose Them'
              WHEN r_score <= 2 AND f_score <= 2 AND m_score <= 2 THEN 'Lost'
              WHEN r_score >= 3 AND f_score <= 2 AND m_score <= 2 THEN 'Needs Attention'
              ELSE 'About to Sleep'
            END as segment,
            -- Composite RFM score
            (r_score + f_score + m_score) as rfm_total_score
          FROM rfm_scores
        )
        SELECT 
          client_id,
          client_name,
          segment,
          recency_days,
          frequency,
          monetary_value,
          avg_order_value,
          purchase_days,
          last_purchase_date,
          r_score,
          f_score,
          m_score,
          rfm_total_score,
          -- Recommended actions
          CASE segment
            WHEN 'Champions' THEN 'Recompensas VIP, early access, solicitar referidos'
            WHEN 'Loyal Customers' THEN 'Programas de fidelidad, upsell productos premium'
            WHEN 'Promising' THEN 'Ofrecer suscripción, onboarding personalizado'
            WHEN 'At Risk' THEN 'Campaña de reactivación urgente, encuesta satisfacción'
            WHEN 'Cant Lose Them' THEN 'Contacto personal directo, ofertas exclusivas'
            WHEN 'Lost' THEN 'Campaña win-back con descuento agresivo'
            WHEN 'Needs Attention' THEN 'Email personalizado, producto recomendado'
            ELSE 'Reengagement suave, contenido educativo'
          END as recommended_action,
          -- Value tier
          CASE 
            WHEN monetary_value >= (SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY monetary_value) FROM rfm_scores) THEN 'High Value'
            WHEN monetary_value >= (SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY monetary_value) FROM rfm_scores) THEN 'Medium Value'
            ELSE 'Low Value'
          END as value_tier
        FROM rfm_segments
        ORDER BY rfm_total_score DESC, monetary_value DESC
        LIMIT 500
      `;

      const customers = await prisma.$queryRawUnsafe<RFMCustomer[]>(rfmQuery, startDate, endDate);

      const segmentSummary = this.calculateSegmentSummary(customers);

      const atRiskRevenue = customers
        .filter(c => ['At Risk', 'Cant Lose Them', 'About to Sleep'].includes(c.segment))
        .reduce((sum, c) => sum + c.monetary_value, 0);

      const summary: RFMAnalysisSummary = {
        total_customers: customers.length,
        segments: segmentSummary,
        value_at_risk: atRiskRevenue,
        champions_count: customers.filter(c => c.segment === 'Champions').length,
        at_risk_count: customers.filter(c => c.segment === 'At Risk').length,
        lost_count: customers.filter(c => c.segment === 'Lost').length,
        avg_customer_value: customers.length > 0
          ? customers.reduce((sum, c) => sum + c.monetary_value, 0) / customers.length
          : 0,
      };


      const narrative = this.generateRFMNarrative(summary, segmentSummary);

      return reply.code(200).send({
        success: true,
        data: {
          summary,
          customers,
          narrative,
          methodology: {
            description: 'Análisis RFM (Recency, Frequency, Monetary) con segmentación automática',
            scoring: 'Escala 1-5 usando NTILE por cuartiles. 5 = mejor desempeño',
            segments: 8,
            lookback_period: `${lookbackDays} días`,
            date_range: `${startDate.toISOString().split('T')[0]} a ${endDate.toISOString().split('T')[0]}`,
          },
        },
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, '[VENTAS HANDLER] Error in getRFMAnalysis:');
      return reply.code(500).send({
        success: false,
        message: 'Error al generar análisis RFM de clientes',
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * Cross-Sell Opportunities - Product affinity analysis
   */
  static async getCrossSellOpportunities(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { fechaInicio, fechaFin, minSupport = 5, limit = 20 } = request.query as CrossSellParams;
      const prisma = request.server.prisma;

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();

      // Product Co-occurrence Analysis (Market Basket Analysis)
      const crossSellQuery = `
        WITH customer_purchases AS (
          SELECT 
            s.client_id,
            s.product_id,
            p.sku,
            p.product_name,
            p.category,
            p.cost,
            AVG(s.unit_price) as avg_price
          FROM sales_partitioned s
          JOIN products p ON s.product_id = p.product_id
          WHERE s.sale_datetime >= $1 
            AND s.sale_datetime < $2 + INTERVAL '1 day'
            AND s.is_deleted = false
            AND p.is_deleted = false
          GROUP BY s.client_id, s.product_id, p.sku, p.product_name, p.category, p.cost
        ),
        product_pairs AS (
          SELECT 
            a.product_id as product_a_id,
            a.sku as product_a_sku,
            a.product_name as product_a_name,
            a.category as product_a_category,
            a.avg_price as product_a_price,
            b.product_id as product_b_id,
            b.sku as product_b_sku,
            b.product_name as product_b_name,
            b.category as product_b_category,
            b.avg_price as product_b_price,
            COUNT(DISTINCT a.client_id) as co_purchase_count
          FROM customer_purchases a
          JOIN customer_purchases b ON a.client_id = b.client_id 
            AND a.product_id < b.product_id
          GROUP BY 
            a.product_id, a.sku, a.product_name, a.category, a.avg_price,
            b.product_id, b.sku, b.product_name, b.category, b.avg_price
          HAVING COUNT(DISTINCT a.client_id) >= $3
        ),
        product_totals AS (
          SELECT 
            product_id,
            COUNT(DISTINCT client_id) as total_buyers
          FROM customer_purchases
          GROUP BY product_id
        ),
        affinity_scores AS (
          SELECT 
            pp.*,
            pta.total_buyers as product_a_buyers,
            ptb.total_buyers as product_b_buyers,
            -- Lift: P(A and B) / (P(A) * P(B))
            (pp.co_purchase_count::float / (SELECT COUNT(DISTINCT client_id) FROM customer_purchases)) / 
            ((pta.total_buyers::float / (SELECT COUNT(DISTINCT client_id) FROM customer_purchases)) *
             (ptb.total_buyers::float / (SELECT COUNT(DISTINCT client_id) FROM customer_purchases))) as lift,
            -- Confidence: P(B|A) = P(A and B) / P(A)
            (pp.co_purchase_count::float / NULLIF(pta.total_buyers, 0)) * 100 as confidence_a_to_b,
            -- Confidence: P(A|B) = P(A and B) / P(B)
            (pp.co_purchase_count::float / NULLIF(ptb.total_buyers, 0)) * 100 as confidence_b_to_a,
            -- Bundle revenue potential
            (pp.product_a_price + pp.product_b_price) * pp.co_purchase_count as bundle_revenue_realized,
            -- Estimated uplift if we promote bundle
            (pp.product_a_price + pp.product_b_price) * 
            (GREATEST(pta.total_buyers, ptb.total_buyers) - pp.co_purchase_count) * 0.15 as estimated_bundle_uplift
          FROM product_pairs pp
          JOIN product_totals pta ON pp.product_a_id = pta.product_id
          JOIN product_totals ptb ON pp.product_b_id = ptb.product_id
        )
        SELECT 
          product_a_id,
          product_a_sku,
          product_a_name,
          product_a_category,
          product_a_price,
          product_b_id,
          product_b_sku,
          product_b_name,
          product_b_category,
          product_b_price,
          co_purchase_count,
          product_a_buyers,
          product_b_buyers,
          ROUND(lift::numeric, 2) as lift,
          ROUND(confidence_a_to_b::numeric, 1) as confidence_a_to_b,
          ROUND(confidence_b_to_a::numeric, 1) as confidence_b_to_a,
          ROUND(bundle_revenue_realized::numeric, 0) as bundle_revenue_realized,
          ROUND(estimated_bundle_uplift::numeric, 0) as estimated_bundle_uplift,
          ROUND((product_a_price + product_b_price) * 0.85::numeric, 2) as suggested_bundle_price,
          -- Recommendation strength
          CASE 
            WHEN lift >= 3 AND confidence_a_to_b >= 40 THEN 'Muy Fuerte'
            WHEN lift >= 2 AND confidence_a_to_b >= 30 THEN 'Fuerte'
            WHEN lift >= 1.5 AND confidence_a_to_b >= 20 THEN 'Moderada'
            ELSE 'Débil'
          END as recommendation_strength,
          -- Action
          CASE 
            WHEN lift >= 3 THEN 'Crear bundle promocional 2x1 o descuento 15%'
            WHEN lift >= 2 THEN 'Sugerir en página de producto con descuento 10%'
            WHEN lift >= 1.5 THEN 'Email cross-sell a compradores de producto A'
            ELSE 'Merchandising visual en tienda'
          END as recommended_action
        FROM affinity_scores
        WHERE lift >= 1.2
        ORDER BY lift DESC, co_purchase_count DESC
        LIMIT $4
      `;

      const opportunities = await prisma.$queryRawUnsafe<CrossSellOpportunity[]>(
        crossSellQuery,
        startDate,
        endDate,
        Number(minSupport),
        Number(limit)
      );

      const totalUplift = opportunities.reduce((sum, o) => sum + o.estimated_bundle_uplift, 0);

      const summary: CrossSellSummary = {
        total_opportunities: opportunities.length,
        strong_opportunities: opportunities.filter(o => o.recommendation_strength === 'Muy Fuerte').length,
        total_estimated_uplift: totalUplift,
        avg_lift: opportunities.length > 0
          ? opportunities.reduce((sum, o) => sum + o.lift, 0) / opportunities.length
          : 0,
        date_range: `${startDate.toISOString().split('T')[0]} a ${endDate.toISOString().split('T')[0]}`,
      };

      const narrative = this.generateCrossSellNarrative(summary, opportunities);

      return reply.code(200).send({
        success: true,
        data: {
          summary,
          opportunities,
          narrative,
          methodology: {
            description: 'Análisis de afinidad de productos usando Market Basket Analysis',
            metrics: {
              lift: 'P(A y B) / (P(A) × P(B)) - Lift > 1 indica correlación positiva',
              confidence: 'P(B|A) - Probabilidad de comprar B dado que compró A',
              support: `Mínimo ${minSupport} co-compras para incluir en análisis`,
            },
            uplift_assumption: 'Estimamos 15% conversion rate en bundles promocionales',
          },
        },
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, '[VENTAS HANDLER] Error in getCrossSellOpportunities:');
      return reply.code(500).send({
        success: false,
        message: 'Error al generar oportunidades de venta cruzada',
        error: getErrorMessage(error),
      });
    }
  }

  // Helper: Generate forecast narrative
  private static generateForecastNarrative(
    forecasts: Awaited<ReturnType<typeof ForecastingQueries.getProductForecasts>>,
    summary: ForecastSummary,
    accuracy: ForecastAccuracyMetrics
  ): string {
    const atRisk = forecasts.filter(f => f.days_until_stockout < 14);
    const trending = forecasts.filter(f => f.trend_direction === 'increasing');

    let narrative = `## Pronóstico de Demanda (30 Días)

**Resumen Ejecutivo:**
- **${summary.total_products} productos** analizados con pronóstico ML
- **Precisión del modelo:** ${accuracy.wmape.toFixed(1)}% WMAPE (últimos 30 días)
- **Confianza promedio:** ${(summary.avg_confidence * 100).toFixed(0)}%
- **Productos en riesgo:** ${summary.products_at_risk} con menos de 14 días de stock

`;

    if (atRisk.length > 0) {
      narrative += `### ⚠️ Productos Críticos (Stock-Out en <14 Días)
`;
      atRisk.slice(0, 5).forEach(p => {
        narrative += `- **${p.sku}**: ${p.days_until_stockout} días restantes, demanda proyectada ${p.forecast_30d.toFixed(0)} unidades\n`;
      });
      narrative += '\n';
    }

    if (trending.length > 0) {
      narrative += `### 📈 Tendencias Crecientes (Oportunidad)
${trending.slice(0, 3).map(p => 
  `- **${p.sku}**: +${p.trend_change_pct}% cambio, pronóstico ${p.forecast_30d.toFixed(0)} unidades`
).join('\n')}

`;
    }

    narrative += `**Metodología:** Pronóstico basado en 90 días de historial con ajuste de tendencia y factores estacionales.`;

    return narrative;
  }

  // Helper: Calculate segment summary
  private static calculateSegmentSummary(customers: RFMCustomer[]): SegmentSummaryEntry[] {
    const segments = ['Champions', 'Loyal Customers', 'Promising', 'At Risk', 'Cant Lose Them', 'Lost', 'Needs Attention', 'About to Sleep'];
    
    return segments.map(segment => {
      const segmentCustomers = customers.filter(c => c.segment === segment);
      const revenue = segmentCustomers.reduce((sum, c) => sum + c.monetary_value, 0);
      
      return {
        segment,
        count: segmentCustomers.length,
        revenue,
        avg_value: segmentCustomers.length > 0 ? revenue / segmentCustomers.length : 0,
        percentage: customers.length > 0 ? (segmentCustomers.length / customers.length) * 100 : 0,
      };
    });
  }

  // Helper: Generate RFM narrative
  private static generateRFMNarrative(summary: RFMAnalysisSummary, segments: SegmentSummaryEntry[]): string {
    const topSegment = segments.reduce((max, s) => s.revenue > max.revenue ? s : max, segments[0]);
    const atRisk = segments.find(s => s.segment === 'At Risk') || { count: 0, revenue: 0 };

    return `## Análisis RFM de Clientes

**Resumen Ejecutivo:**
- **${summary.total_customers} clientes** analizados
- **Segmento dominante:** ${topSegment.segment} (${topSegment.count} clientes, Q${topSegment.revenue.toFixed(0)} en ingresos)
- **Champions:** ${summary.champions_count} clientes de alto valor
- **Valor en riesgo:** Q${summary.value_at_risk.toFixed(0)} de clientes en riesgo de abandono

**Acciones Prioritarias:**
${atRisk.count > 0 ? `1. **Reactivar ${atRisk.count} clientes en riesgo** (Q${atRisk.revenue.toFixed(0)} en juego)` : ''}
2. **Maximizar Champions:** Programa VIP y solicitud de referidos
3. **Recuperar clientes perdidos:** Campaña win-back con oferta especial

**Metodología:** Scoring RFM 1-5 usando percentiles. Segmentación automática en 8 categorías.`;
  }

  // Helper: Generate cross-sell narrative
  private static generateCrossSellNarrative(summary: CrossSellSummary, opportunities: CrossSellOpportunity[]): string {
    const topOpp = opportunities[0];
    
    let narrative = `## Oportunidades de Venta Cruzada

**Resumen Ejecutivo:**
- **${summary.total_opportunities} pares de productos** con alta afinidad detectada
- **${summary.strong_opportunities} oportunidades muy fuertes** (Lift ≥3.0)
- **Uplift estimado:** Q${summary.total_estimated_uplift.toFixed(0)} en ingresos adicionales
- **Lift promedio:** ${summary.avg_lift.toFixed(2)}x

`;

    if (topOpp) {
      narrative += `### 💡 Oportunidad #1 (Mayor Potencial)
**Bundle Sugerido:** ${topOpp.product_a_name} + ${topOpp.product_b_name}
- **Lift:** ${topOpp.lift}x (${Number(topOpp.lift) >= 3 ? 'Muy fuerte' : 'Fuerte'} correlación)
- **Confidence:** ${topOpp.confidence_a_to_b}% de compradores de A también compran B
- **Co-compras históricas:** ${topOpp.co_purchase_count} clientes
- **Precio individual:** Q${(Number(topOpp.product_a_price) + Number(topOpp.product_b_price)).toFixed(2)}
- **Precio bundle sugerido:** Q${topOpp.suggested_bundle_price} (15% descuento)
- **Uplift estimado:** Q${topOpp.estimated_bundle_uplift}

**Acción:** ${topOpp.recommended_action}

`;
    }

    narrative += `**Metodología:** Market Basket Analysis. Lift = P(A y B) / (P(A) × P(B)). Lift > 1 indica correlación positiva.`;

    return narrative;
  }
}