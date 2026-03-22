// api-node/src/routes/bi/handlers/inventario.handler.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { QueryBuilder } from '../utils/query-builder';

interface TransactionHistoryEntry {
  date: string;
  type: string;
  quantity: number;
  location: string;
}

interface AIDiscrepancy {
  product_id: number;
  sku: string;
  product_name: string;
  system_quantity: number;
  location_zone: string;
  bin_location: string | null;
  anomaly_type: 'dead_stock' | 'phantom_stock' | 'location_mismatch' | 'velocity_mismatch' | 'negative_trend';
  confidence_score: number;
  last_movement_date: string | null;
  days_since_movement: number;
  expected_picks: number;
  actual_picks: number;
  variance_value: number;
  root_cause: string;
  recommended_action: string;
  priority: 'high' | 'medium' | 'low';
  transaction_history: Array<{
    date: string;
    type: string;
    quantity: number;
    location: string;
  }>;
}

interface AIDiscrepancyRow {
  product_id: number;
  sku: string;
  product_name: string;
  system_quantity: number;
  location_zone: string;
  bin_location: string | null;
  anomaly_type: 'dead_stock' | 'phantom_stock' | 'location_mismatch' | 'velocity_mismatch' | 'negative_trend' | null;
  confidence_score: number;
  last_movement_date: string | null;
  days_since_movement: number;
  expected_picks: number;
  actual_picks: number;
  variance_value: number;
  priority: 'high' | 'medium' | 'low';
  transaction_history: TransactionHistoryEntry[] | null;
}

interface AIDiscrepancySummary {
  total_discrepancies: number;
  high_priority: number;
  medium_priority: number;
  low_priority: number;
  total_variance_value: number;
  affected_skus: number;
}

interface RecommendationRow {
  product_id: number;
  sku: string | null;
  product_name: string | null;
  category: string | null;
  current_stock: number | null;
  daily_velocity: number | null;
  days_until_stockout: number | null;
  forecast_30d: number | null;
  safety_stock: number | null;
  calculated_reorder_point: number | null;
  recommended_qty: number | null;
  confidence_score: number | null;
  priority: 'urgente' | 'alta' | 'media' | 'baja' | null;
  supplier_id: number | null;
  supplier_name: string | null;
  lead_time_days: number | null;
  lead_time_variance: number | null;
  moq: number | null;
  supplier_reliability: number | null;
  unit_cost: number | null;
  demand_volatility: number | null;
  days_with_sales: number | null;
}

interface ReorderSummary {
  total_recommendations: number;
  urgent_count: number;
  high_priority_count: number;
  medium_priority_count: number;
  total_estimated_cost: number;
  products_near_stockout: number;
  avg_confidence: number;
}

interface OptimizationItem {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  current_stock: number;
  unit_cost: number;
  inventory_value: number;
  location_zone: string;
  shelf_life_days: number;
  expiry_date: string | null;
  last_sale_date: string | null;
  days_no_sales: number;
  days_with_sales: number;
  total_sold_90d: number;
  daily_velocity: number;
  last_movement_date: string | null;
  days_since_movement: number;
  movement_count: number;
  forecast_90d: number;
  forecast_method: string;
  inventory_age_days: number;
  days_until_expiry: number | null;
  holding_cost_accumulated: number;
  issue_type: 'slow_mover' | 'aged_inventory' | 'overstock' | 'normal';
  priority: 'critical' | 'high' | 'medium' | 'low';
  demand_trend: 'declining' | 'growing' | 'stable';
  excess_quantity: number;
  excess_value: number;
  recommended_discount_pct: number;
  urgency_score: number;
  recommended_action: string;
  action_rationale: string;
  estimated_recovery: number;
}

interface OptimizationSummary {
  total_items: number;
  slow_movers: number;
  aged_inventory: number;
  overstock: number;
  total_excess_value: number;
  total_inventory_value: number;
  total_holding_costs: number;
  estimated_cash_recovery: number;
  critical_items: number;
  high_priority_items: number;
}

interface ImpactMetrics {
  capital_tied_up: number;
  monthly_holding_cost: number;
  potential_savings_annual: number;
  inventory_reduction_pct: number;
  forecast_coverage: string;
}

interface OptimizationAction {
  action: string;
  rationale: string;
  estimatedRecovery: number;
}

interface StockOptimizationRow {
  product_id: number;
  sku: string | null;
  product_name: string | null;
  category: string | null;
  current_stock: number | null;
  unit_cost: number | null;
  inventory_value: number | null;
  location_zone: string | null;
  shelf_life_days: number | null;
  expiry_date: string | null;
  last_sale_date: string | null;
  days_no_sales: number | null;
  days_with_sales: number | null;
  total_sold_90d: number | null;
  daily_velocity: number | null;
  last_movement_date: string | null;
  days_since_movement: number | null;
  movement_count: number | null;
  forecast_90d: number | null;
  forecast_method: string | null;
  inventory_age_days: number | null;
  days_until_expiry: number | null;
  holding_cost_accumulated: number | null;
  issue_type: 'slow_mover' | 'aged_inventory' | 'overstock' | 'normal';
  priority: 'critical' | 'high' | 'medium' | 'low';
  demand_trend: 'declining' | 'growing' | 'stable';
  excess_quantity: number | null;
  excess_value: number | null;
  recommended_discount_pct: number | null;
  urgency_score: number | null;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface AIDiscrepancyResponse {
  success: boolean;
  data: {
    summary: {
      total_discrepancies: number;
      high_priority: number;
      medium_priority: number;
      low_priority: number;
      total_variance_value: number;
      affected_skus: number;
    };
    discrepancies: AIDiscrepancy[];
    ai_metrics: {
      detection_algorithm: string;
      confidence_threshold: number;
      last_analysis_run: string;
      data_quality_score: number;
    };
  };
}

export class InventarioHandler {
  /**
   * AI-powered discrepancy detection
   * Analyzes transaction patterns to identify inventory anomalies
   */
  static async getAIDiscrepancies(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const prisma = request.server.prisma;
      const { fechaInicio, fechaFin, minConfidence, limit } = request.query as {
        fechaInicio?: string; fechaFin?: string; minConfidence?: string; limit?: string;
      };

      // Parse parameters with safe defaults
      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();
      const confidenceThreshold = minConfidence ? parseFloat(minConfidence) : 0.7;
      const maxResults = limit ? parseInt(limit) : 50;

      request.log.info({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        confidenceThreshold,
        maxResults
      }, '[INVENTARIO HANDLER] AI Discrepancy Analysis:');

      // Complex AI-powered anomaly detection query
      const query = `
        WITH current_inventory AS (
          SELECT 
            i.product_id,
            p.sku,
            p.product_name,
            COALESCE(i.quantity_on_hand, 0) as system_quantity,
            COALESCE(i.location_zone, 'MAIN') as location_zone,
            i.bin_location,
            COALESCE(i.unit_cost, p.cost, 0) as unit_cost,
            i.snapshot_timestamp
          FROM inventory_snapshots i
          JOIN products p ON i.product_id = p.product_id
          WHERE i.snapshot_timestamp = (
            SELECT MAX(snapshot_timestamp) 
            FROM inventory_snapshots 
            WHERE is_deleted = false
          )
            AND i.is_deleted = false
            AND p.is_deleted = false
        ),
        
        movement_analysis AS (
          SELECT 
            im.product_id,
            MAX(im.created_at) as last_movement_date,
            EXTRACT(DAY FROM NOW() - MAX(im.created_at)) as days_since_movement,
            COUNT(*) FILTER (WHERE im.movement_type IN ('sale', 'shipment')) as pick_count,
            COUNT(*) FILTER (WHERE im.created_at >= $1 AND im.created_at < $2) as recent_movements,
            ARRAY_AGG(
              json_build_object(
                'date', im.created_at,
                'type', im.movement_type,
                'quantity', im.quantity,
                'location', COALESCE(im.from_location, im.to_location, '-')
              ) ORDER BY im.created_at DESC
            ) FILTER (WHERE im.created_at >= $1 AND im.created_at < $2) as transaction_history
          FROM inventory_movements im
          GROUP BY im.product_id
        ),
        
        sales_velocity AS (
          SELECT 
            product_id,
            COUNT(DISTINCT DATE(sale_datetime)) as days_with_sales,
            SUM(quantity * uom_ratio) as total_sold,
            AVG(quantity * uom_ratio) as avg_daily_demand,
            STDDEV(quantity * uom_ratio) as demand_stddev
          FROM sales_partitioned
          WHERE sale_datetime >= $1 
            AND sale_datetime < $2
          GROUP BY product_id
        ),
        
        anomaly_detection AS (
          SELECT 
            ci.product_id,
            ci.sku,
            ci.product_name,
            ci.system_quantity,
            ci.location_zone,
            ci.bin_location,
            ci.unit_cost,
            
            -- Movement data
            COALESCE(ma.last_movement_date, ci.snapshot_timestamp) as last_movement_date,
            COALESCE(ma.days_since_movement, 999) as days_since_movement,
            COALESCE(ma.pick_count, 0) as actual_picks,
            COALESCE(ma.recent_movements, 0) as recent_movements,
            ma.transaction_history,
            
            -- Sales velocity
            COALESCE(sv.days_with_sales, 0) as days_with_sales,
            COALESCE(sv.total_sold, 0) as total_sold,
            COALESCE(sv.avg_daily_demand, 0) as avg_daily_demand,
            
            -- Expected picks based on sales velocity
            CASE 
              WHEN sv.avg_daily_demand > 0 
              THEN CEIL(sv.avg_daily_demand * EXTRACT(DAY FROM $2 - $1))
              ELSE 0 
            END as expected_picks,
            
            -- Anomaly scoring logic
            CASE
              -- Dead stock: Has inventory but no movement in 90+ days
              WHEN ci.system_quantity > 0 
                   AND COALESCE(ma.days_since_movement, 999) >= 90 
                   AND COALESCE(ma.recent_movements, 0) = 0
              THEN 'dead_stock'
              
              -- Phantom stock: System shows stock but no picks despite sales velocity
              WHEN ci.system_quantity > 0 
                   AND sv.avg_daily_demand > 0.5
                   AND COALESCE(ma.pick_count, 0) = 0
                   AND COALESCE(ma.days_since_movement, 999) >= 30
              THEN 'phantom_stock'
              
              -- Velocity mismatch: Expected picks vs actual picks differ significantly
              WHEN sv.avg_daily_demand > 0
                   AND ABS(
                     COALESCE(ma.pick_count, 0) - 
                     (sv.avg_daily_demand * EXTRACT(DAY FROM $2 - $1))
                   ) > (sv.avg_daily_demand * 10)
              THEN 'velocity_mismatch'
              
              -- Location mismatch: Multiple movements but stock in wrong zone
              WHEN ci.location_zone = 'RECEIVING' 
                   AND COALESCE(ma.days_since_movement, 999) >= 7
                   AND ci.system_quantity > 0
              THEN 'location_mismatch'
              
              -- Negative trend: Declining accuracy over time
              WHEN ci.system_quantity > 0
                   AND COALESCE(ma.recent_movements, 0) > 5
                   AND COALESCE(ma.pick_count, 0) < (sv.avg_daily_demand * EXTRACT(DAY FROM $2 - $1) * 0.5)
              THEN 'negative_trend'
              
              ELSE NULL
            END as anomaly_type,
            
            -- Confidence score (0-1)
            CASE
              WHEN ci.system_quantity > 0 AND COALESCE(ma.days_since_movement, 999) >= 180 THEN 0.95
              WHEN ci.system_quantity > 0 AND COALESCE(ma.days_since_movement, 999) >= 90 THEN 0.85
              WHEN sv.avg_daily_demand > 1 AND COALESCE(ma.pick_count, 0) = 0 THEN 0.90
              WHEN ABS(COALESCE(ma.pick_count, 0) - COALESCE(sv.total_sold, 0)) > 50 THEN 0.80
              WHEN ci.location_zone = 'RECEIVING' AND COALESCE(ma.days_since_movement, 999) >= 14 THEN 0.88
              ELSE 0.70
            END as confidence_score,
            
            -- Financial impact
            ci.system_quantity * ci.unit_cost as variance_value,
            
            -- Priority calculation
            CASE
              WHEN ci.system_quantity * ci.unit_cost > 10000 THEN 'high'
              WHEN ci.system_quantity * ci.unit_cost > 5000 THEN 'medium'
              ELSE 'low'
            END as priority
            
          FROM current_inventory ci
          LEFT JOIN movement_analysis ma ON ci.product_id = ma.product_id
          LEFT JOIN sales_velocity sv ON ci.product_id = sv.product_id
          WHERE ci.system_quantity > 0  -- Only analyze items with inventory
        )
        
        SELECT 
          product_id,
          sku,
          product_name,
          system_quantity,
          location_zone,
          bin_location,
          anomaly_type,
          confidence_score,
          last_movement_date,
          days_since_movement,
          expected_picks,
          actual_picks,
          variance_value,
          priority,
          transaction_history
        FROM anomaly_detection
        WHERE anomaly_type IS NOT NULL
          AND confidence_score >= $3
        ORDER BY 
          CASE priority
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            ELSE 3
          END,
          confidence_score DESC,
          variance_value DESC
        LIMIT $4
      `;

      const params = [
        startDate.toISOString(),
        endDate.toISOString(),
        confidenceThreshold,
        maxResults
      ];

      const results: AIDiscrepancyRow[] = await QueryBuilder.executeWithDebug<AIDiscrepancyRow[]>(
        prisma,
        query,
        params,
        'InventarioHandler.getAIDiscrepancies'
      );

      // Transform results and add root cause analysis + recommendations
      const discrepancies: AIDiscrepancy[] = results.map((row: AIDiscrepancyRow) => {
        const rowTyped = row;
        const { rootCause, recommendation } = this.analyzeRootCause(rowTyped);
        
        return {
          product_id: Number(rowTyped.product_id),
          sku: rowTyped.sku || 'N/A',
          product_name: rowTyped.product_name || 'Producto Desconocido',
          system_quantity: Number(rowTyped.system_quantity) || 0,
          location_zone: rowTyped.location_zone || 'MAIN',
          bin_location: rowTyped.bin_location,
          anomaly_type: rowTyped.anomaly_type!,
          confidence_score: Number(rowTyped.confidence_score) || 0.7,
          last_movement_date: rowTyped.last_movement_date,
          days_since_movement: Number(rowTyped.days_since_movement) || 0,
          expected_picks: Number(rowTyped.expected_picks) || 0,
          actual_picks: Number(rowTyped.actual_picks) || 0,
          variance_value: Number(rowTyped.variance_value) || 0,
          root_cause: rootCause,
          recommended_action: recommendation,
          priority: rowTyped.priority || 'low',
          transaction_history: rowTyped.transaction_history || []
        };
      });

      // Calculate summary statistics
      const summary: AIDiscrepancySummary = {
        total_discrepancies: discrepancies.length,
        high_priority: discrepancies.filter(d => d.priority === 'high').length,
        medium_priority: discrepancies.filter(d => d.priority === 'medium').length,
        low_priority: discrepancies.filter(d => d.priority === 'low').length,
        total_variance_value: discrepancies.reduce((sum, d) => sum + d.variance_value, 0),
        affected_skus: discrepancies.length
      };

      // AI metrics for transparency
      const ai_metrics = {
        detection_algorithm: 'Transaction Pattern Analysis + Velocity Correlation',
        confidence_threshold: confidenceThreshold,
        last_analysis_run: new Date().toISOString(),
        data_quality_score: this.calculateDataQualityScore(discrepancies)
      };

      const response: AIDiscrepancyResponse = {
        success: true,
        data: {
          summary,
          discrepancies,
          ai_metrics
        }
      };

      reply.status(200).send(response);

    } catch (error: unknown) {
      request.log.error({ err: error }, '[INVENTARIO HANDLER] Error in AI discrepancy analysis:');
      reply.status(500).send({
        success: false,
        error: 'Error al analizar discrepancias con IA',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * Analyze root cause and generate actionable recommendations
   */
  private static analyzeRootCause(discrepancy: AIDiscrepancyRow): { rootCause: string; recommendation: string } {
    const type = discrepancy.anomaly_type;
    const days = discrepancy.days_since_movement;
    const systemQty = discrepancy.system_quantity;
    const zone = discrepancy.location_zone;

    switch (type) {
      case 'dead_stock':
        return {
          rootCause: `Stock inactivo por ${days} días. Posibles causas: producto obsoleto, ubicación incorrecta, o error de registro.`,
          recommendation: `Prioridad: Realizar conteo físico inmediato en zona ${zone}. Si se confirma, considerar liquidación o transferencia a zona de baja rotación.`
        };

      case 'phantom_stock':
        return {
          rootCause: `Sistema indica ${systemQty} unidades disponibles, pero no hay movimientos de picking a pesar de demanda activa. Posible robo, daño no registrado, o ubicación perdida.`,
          recommendation: `URGENTE: Conteo físico completo. Verificar registros de seguridad. Si no se encuentra, ajustar sistema y activar procedimiento de merma.`
        };

      case 'velocity_mismatch':
        return {
          rootCause: `Diferencia significativa entre picks esperados (${discrepancy.expected_picks}) y reales (${discrepancy.actual_picks}). Indica problemas de registro o picking no autorizado.`,
          recommendation: `Auditar últimos ${Math.min(days, 30)} días de transacciones. Verificar integridad de lectores de código de barras en zona ${zone}.`
        };

      case 'location_mismatch':
        return {
          rootCause: `Producto permanece en zona ${zone} por ${days} días, indicando falta de procesamiento en flujo de almacén.`,
          recommendation: `Transferir inmediatamente a zona correcta. Revisar proceso de recepción y put-away para evitar repetición.`
        };

      case 'negative_trend':
        return {
          rootCause: `Patrón de movimientos inconsistente con histórico de ventas. Puede indicar picking manual no registrado o sustituciones no autorizadas.`,
          recommendation: `Implementar conteo cíclico semanal por 4 semanas. Revisar permisos de acceso a zona ${zone}.`
        };

      default:
        return {
          rootCause: 'Anomalía detectada por algoritmo de IA, causa específica requiere investigación manual.',
          recommendation: 'Realizar conteo físico y revisar historial de transacciones completo.'
        };
    }
  }

  /**
   * Calculate data quality score for AI transparency
   */
  private static calculateDataQualityScore(discrepancies: AIDiscrepancy[]): number {
    if (discrepancies.length === 0) return 100;

    const avgConfidence = discrepancies.reduce((sum, d) => sum + d.confidence_score, 0) / discrepancies.length;
    const withTransactionHistory = discrepancies.filter(d => d.transaction_history && d.transaction_history.length > 0).length;
    const historyScore = (withTransactionHistory / discrepancies.length) * 100;

    // Weighted average: 70% confidence, 30% transaction history completeness
    return Math.round((avgConfidence * 70) + (historyScore * 0.3));
  }

  /**
   * Get ML-powered reorder recommendations
   * Handles gracefully if forecasts table is empty - uses historical velocity instead
   */
  static async getReorderRecommendations(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const prisma = request.server.prisma;
      const { fechaInicio, fechaFin, minConfidence, limit } = request.query as {
        fechaInicio?: string; fechaFin?: string; minConfidence?: string; limit?: string;
      };

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();
      const confidenceThreshold = minConfidence ? parseFloat(minConfidence) : 0.6;
      const maxResults = limit ? parseInt(limit) : 50;

      request.log.info({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        confidenceThreshold,
        maxResults
      }, '[INVENTARIO HANDLER] Reorder Recommendations:');

      // Complex reorder recommendation query with graceful forecast handling
      const query = `
        WITH current_inventory AS (
          SELECT 
            i.product_id,
            p.sku,
            p.product_name,
            p.category,
            COALESCE(i.quantity_on_hand, 0) as current_stock,
            COALESCE(i.min_quantity, 0) as min_quantity,
            COALESCE(i.max_quantity, 999999) as max_quantity,
            COALESCE(i.reorder_point, 0) as reorder_point,
            COALESCE(i.unit_cost, p.cost, 0) as unit_cost,
            i.location_zone,
            i.quality_status
          FROM inventory_snapshots i
          JOIN products p ON i.product_id = p.product_id
          WHERE i.snapshot_timestamp = (
            SELECT MAX(snapshot_timestamp) 
            FROM inventory_snapshots 
            WHERE is_deleted = false
          )
            AND i.is_deleted = false
            AND p.is_deleted = false
            AND COALESCE(i.quantity_on_hand, 0) > 0
        ),
        
        sales_velocity AS (
          SELECT 
            product_id,
            COUNT(DISTINCT DATE(sale_datetime)) as days_with_sales,
            SUM(quantity * uom_ratio) as total_sold_90d,
            AVG(quantity * uom_ratio) as avg_daily_demand,
            STDDEV(quantity * uom_ratio) as demand_stddev,
            SUM(quantity * uom_ratio) / NULLIF(COUNT(DISTINCT DATE(sale_datetime)), 0) as daily_velocity,
            -- Coefficient of variation for volatility
            STDDEV(quantity * uom_ratio) / NULLIF(AVG(quantity * uom_ratio), 0) as demand_volatility
          FROM sales_partitioned
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
            AND sale_datetime < CURRENT_DATE
            AND is_deleted = false
          GROUP BY product_id
          HAVING SUM(quantity * uom_ratio) > 0
        ),
        
        forecast_data AS (
          -- Try to get forecast data, but handle gracefully if empty
          SELECT 
            product_id,
            SUM(predicted_demand) as forecast_30d,
            AVG(COALESCE(accuracy_score, 0.75)) as avg_confidence
          FROM forecasts
          WHERE forecast_date >= CURRENT_DATE
            AND forecast_date < CURRENT_DATE + INTERVAL '30 days'
          GROUP BY product_id
        ),
        
        supplier_info AS (
          SELECT 
            p.product_id,
            s.supplier_id,
            s.supplier_name,
            COALESCE(s.lead_time_days, 14) as lead_time_days,
            COALESCE(p.moq, 1) as moq,
            -- Calculate average lead time from historical purchases
            COALESCE(
              AVG(EXTRACT(EPOCH FROM (pur.actual_delivery_date - pur.purchase_datetime))/86400),
              s.lead_time_days,
              14
            ) as avg_actual_lead_time,
            COALESCE(
              STDDEV(EXTRACT(EPOCH FROM (pur.actual_delivery_date - pur.purchase_datetime))/86400),
              3
            ) as lead_time_variance,
            COUNT(pur.purchase_id) as purchase_count,
            AVG(CASE 
              WHEN pur.actual_delivery_date <= pur.expected_delivery_date THEN 1.0 
              ELSE 0.0 
            END) as on_time_rate
          FROM products p
          LEFT JOIN purchases pur ON p.product_id = pur.product_id
            AND pur.purchase_datetime >= CURRENT_DATE - INTERVAL '180 days'
          LEFT JOIN suppliers s ON pur.supplier_id = s.supplier_id
          GROUP BY p.product_id, s.supplier_id, s.supplier_name, s.lead_time_days, p.moq
        ),
        
        best_suppliers AS (
          SELECT DISTINCT ON (product_id)
            product_id,
            supplier_id,
            supplier_name,
            lead_time_days,
            avg_actual_lead_time,
            lead_time_variance,
            moq,
            on_time_rate,
            purchase_count
          FROM supplier_info
          ORDER BY product_id, on_time_rate DESC NULLS LAST, purchase_count DESC
        ),
        
        reorder_calculations AS (
          SELECT 
            ci.product_id,
            ci.sku,
            ci.product_name,
            ci.category,
            ci.current_stock,
            ci.unit_cost,
            ci.location_zone,
            
            -- Sales velocity metrics
            COALESCE(sv.daily_velocity, 0) as daily_velocity,
            COALESCE(sv.demand_stddev, 0) as demand_stddev,
            COALESCE(sv.demand_volatility, 0.5) as demand_volatility,
            COALESCE(sv.days_with_sales, 0) as days_with_sales,
            
            -- Forecast (use historical if no ML forecast available)
            COALESCE(
              fd.forecast_30d,
              sv.daily_velocity * 30
            ) as forecast_30d,
            
            -- Confidence score
            COALESCE(
              fd.avg_confidence * (1 - LEAST(sv.demand_volatility, 0.9)),
              CASE 
                WHEN sv.days_with_sales >= 60 THEN 0.85
                WHEN sv.days_with_sales >= 30 THEN 0.70
                WHEN sv.days_with_sales >= 14 THEN 0.55
                ELSE 0.40
              END
            ) as confidence_score,
            
            -- Supplier info
            COALESCE(bs.supplier_id, 0) as supplier_id,
            COALESCE(bs.supplier_name, 'Sin proveedor asignado') as supplier_name,
            COALESCE(bs.avg_actual_lead_time, 14) as lead_time_days,
            COALESCE(bs.lead_time_variance, 3) as lead_time_variance,
            COALESCE(bs.moq, 1) as moq,
            COALESCE(bs.on_time_rate, 0.90) as supplier_reliability,
            
            -- Safety stock: 2 standard deviations
            GREATEST(
              1,
              CEIL(2 * COALESCE(sv.demand_stddev, sv.daily_velocity * 0.3))
            ) as safety_stock,
            
            -- Lead time demand
            CEIL(
              COALESCE(sv.daily_velocity, 0) * 
              COALESCE(bs.avg_actual_lead_time, 14)
            ) as lead_time_demand,
            
            -- Reorder point
            GREATEST(
              ci.reorder_point,
              CEIL(
                COALESCE(sv.daily_velocity, 0) * COALESCE(bs.avg_actual_lead_time, 14) +
                2 * COALESCE(sv.demand_stddev, sv.daily_velocity * 0.3)
              )
            ) as calculated_reorder_point,
            
            -- Days until stockout
            CASE 
              WHEN COALESCE(sv.daily_velocity, 0) > 0 
              THEN FLOOR(ci.current_stock / NULLIF(sv.daily_velocity, 0))
              ELSE 999
            END as days_until_stockout,
            
            -- Recommended order quantity
            GREATEST(
              -- Forecast + safety stock - current stock
              COALESCE(fd.forecast_30d, sv.daily_velocity * 30) + 
              CEIL(2 * COALESCE(sv.demand_stddev, sv.daily_velocity * 0.3)) -
              ci.current_stock,
              -- MOQ
              COALESCE(bs.moq, 1),
              -- Minimum 1
              1
            ) as recommended_qty,
            
            -- Priority calculation
            CASE 
              WHEN sv.daily_velocity > 0 AND (ci.current_stock / NULLIF(sv.daily_velocity, 0)) < 7 
                THEN 'urgente'
              WHEN sv.daily_velocity > 0 AND (ci.current_stock / NULLIF(sv.daily_velocity, 0)) < 14 
                THEN 'alta'
              WHEN ci.current_stock <= ci.reorder_point 
                THEN 'media'
              ELSE 'baja'
            END as priority,
            
            -- Should reorder flag
            CASE 
              WHEN ci.current_stock <= GREATEST(
                ci.reorder_point,
                CEIL(
                  COALESCE(sv.daily_velocity, 0) * COALESCE(bs.avg_actual_lead_time, 14) +
                  2 * COALESCE(sv.demand_stddev, sv.daily_velocity * 0.3)
                )
              ) THEN true
              WHEN sv.daily_velocity > 0 AND (ci.current_stock / NULLIF(sv.daily_velocity, 0)) < 14
                THEN true
              ELSE false
            END as should_reorder
            
          FROM current_inventory ci
          LEFT JOIN sales_velocity sv ON ci.product_id = sv.product_id
          LEFT JOIN forecast_data fd ON ci.product_id = fd.product_id
          LEFT JOIN best_suppliers bs ON ci.product_id = bs.product_id
          WHERE COALESCE(sv.daily_velocity, 0) > 0
        )
        
        SELECT *
        FROM reorder_calculations
        WHERE should_reorder = true
          AND confidence_score >= $1
        ORDER BY 
          CASE priority
            WHEN 'urgente' THEN 1
            WHEN 'alta' THEN 2
            WHEN 'media' THEN 3
            ELSE 4
          END,
          days_until_stockout ASC,
          recommended_qty * unit_cost DESC
        LIMIT $2
      `;

      const params = [confidenceThreshold, maxResults];

      const results: RecommendationRow[] = await QueryBuilder.executeWithDebug<RecommendationRow[]>(
        prisma,
        query,
        params,
        'InventarioHandler.getReorderRecommendations'
      );

      // Transform results with recommendations
      const recommendations = results.map((row: RecommendationRow) => {
        const rowTyped = row;
        return {
          product_id: Number(rowTyped.product_id),
          sku: rowTyped.sku || 'N/A',
          product_name: rowTyped.product_name || 'Producto Desconocido',
          category: rowTyped.category || 'Sin Categoría',
          current_stock: Number(rowTyped.current_stock) || 0,
          daily_velocity: Number(rowTyped.daily_velocity) || 0,
          days_until_stockout: Number(rowTyped.days_until_stockout) || 999,
          forecast_30d: Number(rowTyped.forecast_30d) || 0,
          safety_stock: Number(rowTyped.safety_stock) || 0,
          reorder_point: Number(rowTyped.calculated_reorder_point) || 0,
          recommended_qty: Number(rowTyped.recommended_qty) || 0,
          confidence_score: Number(rowTyped.confidence_score) || 0,
          priority: rowTyped.priority || 'baja',
          supplier_id: Number(rowTyped.supplier_id) || null,
          supplier_name: rowTyped.supplier_name || 'Sin proveedor asignado',
          lead_time_days: Number(rowTyped.lead_time_days) || 14,
          lead_time_variance: Number(rowTyped.lead_time_variance) || 3,
          moq: Number(rowTyped.moq) || 1,
          supplier_reliability: Number(rowTyped.supplier_reliability) || 0.90,
          unit_cost: Number(rowTyped.unit_cost) || 0,
          estimated_cost: (Number(rowTyped.recommended_qty) || 0) * (Number(rowTyped.unit_cost) || 0),
          demand_volatility: Number(rowTyped.demand_volatility) || 0,
          days_with_sales: Number(rowTyped.days_with_sales) || 0
        };
      });

      // Calculate summary statistics
      const summary: ReorderSummary = {
        total_recommendations: recommendations.length,
        urgent_count: recommendations.filter(r => r.priority === 'urgente').length,
        high_priority_count: recommendations.filter(r => r.priority === 'alta').length,
        medium_priority_count: recommendations.filter(r => r.priority === 'media').length,
        total_estimated_cost: recommendations.reduce((sum, r) => sum + r.estimated_cost, 0),
        products_near_stockout: recommendations.filter(r => r.days_until_stockout < 7).length,
        avg_confidence: recommendations.length > 0 
          ? recommendations.reduce((sum, r) => sum + r.confidence_score, 0) / recommendations.length 
          : 0
      };

      // AI methodology explanation
      const methodology = {
        algorithm: 'Safety Stock + Lead Time Demand',
        description: recommendations.some(r => r.forecast_30d > 0) 
          ? 'Recomendaciones basadas en pronósticos ML cuando disponibles, con fallback a velocidad histórica de 90 días'
          : 'Recomendaciones basadas en velocidad histórica de ventas de 90 días (pronósticos ML no disponibles)',
        inputs: [
          'Velocidad de venta diaria (promedio 90 días)',
          'Volatilidad de demanda (desviación estándar)',
          'Tiempo de entrega del proveedor',
          'Stock de seguridad (2 desviaciones estándar)',
          'MOQ (Cantidad Mínima de Orden) del proveedor'
        ],
        confidence_factors: [
          'Calidad de datos históricos (días con ventas)',
          'Volatilidad de demanda (coeficiente de variación)',
          'Confiabilidad del proveedor (% entregas a tiempo)',
          'Disponibilidad de pronósticos ML'
        ]
      };

      const response = {
        success: true,
        data: {
          summary,
          recommendations,
          methodology
        }
      };

      reply.status(200).send(response);

    } catch (error: unknown) {
      request.log.error({ err: error }, '[INVENTARIO HANDLER] Error in reorder recommendations:');
      reply.status(500).send({
        success: false,
        error: 'Error al generar recomendaciones de reabastecimiento',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * Stock Optimization Analysis
   * Identifies slow movers, aged inventory, and overstock with actionable recommendations
   */
  static async getStockOptimization(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const prisma = request.server.prisma;
      const { fechaInicio, fechaFin, minValue, limit } = request.query as {
        fechaInicio?: string; fechaFin?: string; minValue?: string; limit?: string;
      };

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();
      const minItemValue = minValue ? parseFloat(minValue) : 1000;
      const maxResults = limit ? parseInt(limit) : 100;

      request.log.info({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        minItemValue,
        maxResults
      }, '[INVENTARIO HANDLER] Stock Optimization Analysis:');

      const query = `
        WITH current_inventory AS (
          SELECT 
            i.product_id,
            p.sku,
            p.product_name,
            p.category,
            COALESCE(i.quantity_on_hand, 0) as current_stock,
            COALESCE(i.unit_cost, p.cost, 0) as unit_cost,
            COALESCE(i.quantity_on_hand, 0) * COALESCE(i.unit_cost, p.cost, 0) as inventory_value,
            COALESCE(i.location_zone, 'MAIN') as location_zone,
            i.snapshot_timestamp,
            COALESCE(p.shelf_life_days, 365) as shelf_life_days,
            i.expiry_date
          FROM inventory_snapshots i
          JOIN products p ON i.product_id = p.product_id
          WHERE i.snapshot_timestamp = (
            SELECT MAX(snapshot_timestamp) 
            FROM inventory_snapshots 
            WHERE is_deleted = false
          )
            AND i.is_deleted = false
            AND p.is_deleted = false
            AND COALESCE(i.quantity_on_hand, 0) > 0
        ),
        
        sales_analysis AS (
          SELECT 
            product_id,
            MAX(sale_datetime) as last_sale_date,
            COUNT(DISTINCT DATE(sale_datetime)) as days_with_sales,
            SUM(quantity * uom_ratio) as total_sold_90d,
            AVG(quantity * uom_ratio) as avg_daily_demand,
            STDDEV(quantity * uom_ratio) as demand_stddev,
            SUM(quantity * uom_ratio) / NULLIF(COUNT(DISTINCT DATE(sale_datetime)), 0) as daily_velocity,
            -- Calculate trend: recent vs older
            AVG(CASE WHEN sale_datetime >= $1::timestamp - INTERVAL '45 days' THEN quantity * uom_ratio END) as recent_velocity,
            AVG(CASE WHEN sale_datetime < $1::timestamp - INTERVAL '45 days' THEN quantity * uom_ratio END) as older_velocity
          FROM sales_partitioned
          WHERE sale_datetime >= $1::timestamp - INTERVAL '90 days'
            AND sale_datetime < $2::timestamp
            AND is_deleted = false
          GROUP BY product_id
        ),
        
        forecast_demand AS (
          -- Try to get ML forecasts, gracefully handle empty table
          SELECT 
            product_id,
            SUM(COALESCE(predicted_demand, 0)) as forecast_90d,
            AVG(COALESCE(accuracy_score, 0)) as avg_accuracy,
            COUNT(*) as forecast_count
          FROM forecasts
          WHERE forecast_date >= $2::timestamp
            AND forecast_date < $2::timestamp + INTERVAL '90 days'
          GROUP BY product_id
        ),
        
        movement_analysis AS (
          SELECT 
            product_id,
            MAX(created_at) as last_movement_date,
            EXTRACT(DAY FROM NOW() - MAX(created_at)) as days_since_movement,
            COUNT(*) FILTER (WHERE movement_type IN ('sale', 'shipment')) as movement_count
          FROM inventory_movements
          WHERE created_at >= $1::timestamp - INTERVAL '180 days'
          GROUP BY product_id
        ),
        
        optimization_analysis AS (
          SELECT 
            ci.product_id,
            ci.sku,
            ci.product_name,
            ci.category,
            ci.current_stock,
            ci.unit_cost,
            ci.inventory_value,
            ci.location_zone,
            ci.shelf_life_days,
            ci.expiry_date,
            
            -- Sales metrics
            COALESCE(sa.last_sale_date, ci.snapshot_timestamp) as last_sale_date,
            COALESCE(EXTRACT(DAY FROM NOW() - sa.last_sale_date), 999) as days_no_sales,
            COALESCE(sa.days_with_sales, 0) as days_with_sales,
            COALESCE(sa.total_sold_90d, 0) as total_sold_90d,
            COALESCE(sa.daily_velocity, 0) as daily_velocity,
            
            -- Movement metrics
            COALESCE(ma.last_movement_date, ci.snapshot_timestamp) as last_movement_date,
            COALESCE(ma.days_since_movement, 999) as days_since_movement,
            COALESCE(ma.movement_count, 0) as movement_count,
            
            -- Forecast vs historical (graceful degradation)
            COALESCE(
              NULLIF(fd.forecast_90d, 0),
              sa.daily_velocity * 90,
              0
            ) as forecast_90d,
            CASE 
              WHEN fd.forecast_count > 0 THEN 'ml_forecast'
              WHEN sa.daily_velocity > 0 THEN 'historical_velocity'
              ELSE 'no_data'
            END as forecast_method,
            
            -- Inventory age
            EXTRACT(DAY FROM NOW() - ci.snapshot_timestamp) as inventory_age_days,
            
            -- Days until expiry (if applicable)
            CASE 
              WHEN ci.expiry_date IS NOT NULL 
              THEN EXTRACT(DAY FROM ci.expiry_date - NOW())
              ELSE NULL
            END as days_until_expiry,
            
            -- Holding cost calculation (25% annual rate)
            (ci.inventory_value * 0.25 / 365 * COALESCE(EXTRACT(DAY FROM NOW() - ci.snapshot_timestamp), 30)) as holding_cost_accumulated,
            
            -- Classification flags
            CASE 
              WHEN COALESCE(sa.days_with_sales, 0) = 0 
                   AND COALESCE(EXTRACT(DAY FROM NOW() - sa.last_sale_date), 999) >= 90 
              THEN 'slow_mover'
              ELSE NULL
            END as slow_mover_flag,
            
            CASE 
              WHEN EXTRACT(DAY FROM NOW() - ci.snapshot_timestamp) >= 180 
              THEN 'aged_inventory'
              ELSE NULL
            END as aged_inventory_flag,
            
            CASE 
              WHEN ci.current_stock > (
                COALESCE(
                  NULLIF(fd.forecast_90d, 0),
                  sa.daily_velocity * 90,
                  0
                ) * 1.5
              )
              AND COALESCE(
                NULLIF(fd.forecast_90d, 0),
                sa.daily_velocity * 90,
                0
              ) > 0
              THEN 'overstock'
              ELSE NULL
            END as overstock_flag,
            
            -- Trend analysis
            CASE 
              WHEN sa.recent_velocity < sa.older_velocity * 0.7 THEN 'declining'
              WHEN sa.recent_velocity > sa.older_velocity * 1.3 THEN 'growing'
              ELSE 'stable'
            END as demand_trend,
            
            -- Excess quantity
            GREATEST(
              0,
              ci.current_stock - (
                COALESCE(
                  NULLIF(fd.forecast_90d, 0),
                  sa.daily_velocity * 90,
                  0
                ) * 1.2
              )
            ) as excess_quantity,
            
            -- Excess value
            GREATEST(
              0,
              ci.current_stock - (
                COALESCE(
                  NULLIF(fd.forecast_90d, 0),
                  sa.daily_velocity * 90,
                  0
                ) * 1.2
              )
            ) * ci.unit_cost as excess_value
            
          FROM current_inventory ci
          LEFT JOIN sales_analysis sa ON ci.product_id = sa.product_id
          LEFT JOIN forecast_demand fd ON ci.product_id = fd.product_id
          LEFT JOIN movement_analysis ma ON ci.product_id = ma.product_id
          WHERE ci.inventory_value >= $3
        ),
        
        categorized_items AS (
          SELECT 
            *,
            -- Primary issue classification
            CASE 
              WHEN slow_mover_flag IS NOT NULL THEN 'slow_mover'
              WHEN aged_inventory_flag IS NOT NULL THEN 'aged_inventory'
              WHEN overstock_flag IS NOT NULL THEN 'overstock'
              ELSE 'normal'
            END as issue_type,
            
            -- Priority calculation
            CASE 
              WHEN inventory_value > 50000 AND days_no_sales >= 180 THEN 'critical'
              WHEN inventory_value > 25000 AND days_no_sales >= 90 THEN 'high'
              WHEN inventory_value > 10000 OR days_no_sales >= 120 THEN 'medium'
              ELSE 'low'
            END as priority,
            
            -- Recommended discount percentage
            CASE 
              WHEN days_no_sales >= 180 OR inventory_age_days >= 270 THEN 30
              WHEN days_no_sales >= 120 OR inventory_age_days >= 180 THEN 20
              WHEN days_no_sales >= 90 OR demand_trend = 'declining' THEN 15
              WHEN overstock_flag IS NOT NULL THEN 10
              ELSE 5
            END as recommended_discount_pct,
            
            -- Action priority score (higher = more urgent)
            (
              CASE WHEN slow_mover_flag IS NOT NULL THEN 100 ELSE 0 END +
              CASE WHEN aged_inventory_flag IS NOT NULL THEN 150 ELSE 0 END +
              CASE WHEN overstock_flag IS NOT NULL THEN 50 ELSE 0 END +
              (LEAST(days_no_sales, 365) / 3) +
              (inventory_value / 1000)
            ) as urgency_score
            
          FROM optimization_analysis
          WHERE slow_mover_flag IS NOT NULL
             OR aged_inventory_flag IS NOT NULL
             OR overstock_flag IS NOT NULL
        )
        
        SELECT 
          product_id,
          sku,
          product_name,
          category,
          current_stock,
          unit_cost,
          inventory_value,
          location_zone,
          shelf_life_days,
          expiry_date,
          last_sale_date,
          days_no_sales,
          days_with_sales,
          total_sold_90d,
          daily_velocity,
          last_movement_date,
          days_since_movement,
          movement_count,
          forecast_90d,
          forecast_method,
          inventory_age_days,
          days_until_expiry,
          holding_cost_accumulated,
          issue_type,
          priority,
          demand_trend,
          excess_quantity,
          excess_value,
          recommended_discount_pct,
          urgency_score
        FROM categorized_items
        ORDER BY urgency_score DESC, inventory_value DESC
        LIMIT $4
      `;

      const params = [
        startDate.toISOString(),
        endDate.toISOString(),
        minItemValue,
        maxResults
      ];

      const results: StockOptimizationRow[] = await QueryBuilder.executeWithDebug<StockOptimizationRow[]>(
        prisma,
        query,
        params,
        'InventarioHandler.getStockOptimization'
      );

      // Transform results and generate recommendations
      /* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
      const optimizationItems: OptimizationItem[] = results.map((row: StockOptimizationRow) => {
        const rowTyped = row;
        const { action, rationale, estimatedRecovery } = this.generateOptimizationAction(rowTyped);
        
        return {
          product_id: Number(rowTyped.product_id),
          sku: rowTyped.sku || 'N/A',
          product_name: rowTyped.product_name || 'Producto Desconocido',
          category: rowTyped.category || 'Sin Categoría',
          current_stock: Number(rowTyped.current_stock) || 0,
          unit_cost: Number(rowTyped.unit_cost) || 0,
          inventory_value: Number(rowTyped.inventory_value) || 0,
          location_zone: rowTyped.location_zone || 'MAIN',
          shelf_life_days: Number(rowTyped.shelf_life_days) || 365,
          expiry_date: rowTyped.expiry_date,
          last_sale_date: rowTyped.last_sale_date,
          days_no_sales: Number(rowTyped.days_no_sales) || 0,
          days_with_sales: Number(rowTyped.days_with_sales) || 0,
          total_sold_90d: Number(rowTyped.total_sold_90d) || 0,
          daily_velocity: Number(rowTyped.daily_velocity) || 0,
          last_movement_date: rowTyped.last_movement_date,
          days_since_movement: Number(rowTyped.days_since_movement) || 0,
          movement_count: Number(rowTyped.movement_count) || 0,
          forecast_90d: Number(rowTyped.forecast_90d) || 0,
          forecast_method: rowTyped.forecast_method || 'no_data',
          inventory_age_days: Number(rowTyped.inventory_age_days) || 0,
          days_until_expiry: rowTyped.days_until_expiry ? Number(rowTyped.days_until_expiry) : null,
          holding_cost_accumulated: Number(rowTyped.holding_cost_accumulated) || 0,
          issue_type: rowTyped.issue_type,
          priority: rowTyped.priority,
          demand_trend: rowTyped.demand_trend,
          excess_quantity: Number(rowTyped.excess_quantity) || 0,
          excess_value: Number(rowTyped.excess_value) || 0,
          recommended_discount_pct: Number(rowTyped.recommended_discount_pct) || 0,
          urgency_score: Number(rowTyped.urgency_score) || 0,
          recommended_action: action,
          action_rationale: rationale,
          estimated_recovery: estimatedRecovery
        };
      });

      // Calculate summary statistics
      const summary: OptimizationSummary = {
        total_items: optimizationItems.length,
        slow_movers: optimizationItems.filter(i => i.issue_type === 'slow_mover').length,
        aged_inventory: optimizationItems.filter(i => i.issue_type === 'aged_inventory').length,
        overstock: optimizationItems.filter(i => i.issue_type === 'overstock').length,
        total_excess_value: optimizationItems.reduce((sum, i) => sum + (i.excess_value || 0), 0),
        total_inventory_value: optimizationItems.reduce((sum, i) => sum + i.inventory_value, 0),
        total_holding_costs: optimizationItems.reduce((sum, i) => sum + i.holding_cost_accumulated, 0),
        estimated_cash_recovery: optimizationItems.reduce((sum, i) => sum + i.estimated_recovery, 0),
        critical_items: optimizationItems.filter(i => i.priority === 'critical').length,
        high_priority_items: optimizationItems.filter(i => i.priority === 'high').length
      };

      // Business impact metrics
      const impact_metrics: ImpactMetrics = {
        capital_tied_up: summary.total_excess_value,
        monthly_holding_cost: (summary.total_inventory_value * 0.25) / 12,
        potential_savings_annual: summary.total_holding_costs * 4, // Annualized
        inventory_reduction_pct: summary.total_excess_value > 0 
          ? (summary.total_excess_value / summary.total_inventory_value * 100)
          : 0,
        forecast_coverage: optimizationItems.filter(i => i.forecast_method === 'ml_forecast').length > 0
          ? 'ml_forecasts_available'
          : 'historical_velocity_fallback'
      };

      const response = {
        success: true,
        data: {
          summary,
          impact_metrics,
        optimization_items: optimizationItems,
          analysis_period: {
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            analysis_run: new Date().toISOString()
          }
        }
      };

      reply.status(200).send(response);

    } catch (error: unknown) {
      request.log.error({ err: error }, '[INVENTARIO HANDLER] Error in stock optimization:');
      reply.status(500).send({
        success: false,
        error: 'Error al analizar optimización de stock',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * Generate specific optimization action based on item characteristics
   */
  /* eslint-disable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
  private static generateOptimizationAction(item: StockOptimizationRow): OptimizationAction {
    const daysNoSales = Number(item.days_no_sales) || 0;
    const inventoryAge = Number(item.inventory_age_days) || 0;
    const inventoryValue = Number(item.inventory_value) || 0;
    const excessQty = Number(item.excess_quantity) || 0;
    const unitCost = Number(item.unit_cost) || 0;
    const discountPct = Number(item.recommended_discount_pct) || 0;
    const daysUntilExpiry = item.days_until_expiry ? Number(item.days_until_expiry) : null;
    const trend = item.demand_trend;

    // Critical: Expiring soon
    if (daysUntilExpiry !== null && daysUntilExpiry < 30) {
      return {
        action: `Liquidación urgente con ${Math.min(discountPct + 20, 50)}% descuento`,
        rationale: `Producto vence en ${Math.floor(daysUntilExpiry)} días. Recuperar valor antes de pérdida total.`,
        estimatedRecovery: inventoryValue * (1 - (discountPct + 20) / 100)
      };
    }

    // Aged inventory (180+ days)
    if (inventoryAge >= 180) {
      if (daysNoSales >= 180) {
        return {
          action: 'Liquidación al costo o donación',
          rationale: `Sin ventas por ${Math.floor(daysNoSales)} días y antigüedad de ${Math.floor(inventoryAge)} días. Prioridad: liberar espacio y recuperar cualquier valor.`,
          estimatedRecovery: inventoryValue * 0.5 // 50% recovery at cost
        };
      } else {
        return {
          action: `Descuento agresivo del ${discountPct}% + bundle con productos de alta rotación`,
          rationale: `Inventario antiguo (${Math.floor(inventoryAge)} días) pero con ventas ocasionales. Combinar con productos populares para acelerar salida.`,
          estimatedRecovery: inventoryValue * (1 - discountPct / 100)
        };
      }
    }

    // Slow mover (90+ days no sales)
    if (daysNoSales >= 90) {
      if (trend === 'declining') {
        return {
          action: `Markdown ${discountPct}% + transferir a outlet/tienda de descuento`,
          rationale: `Demanda en declive y ${Math.floor(daysNoSales)} días sin ventas. Mover a canal de liquidación.`,
          estimatedRecovery: inventoryValue * (1 - discountPct / 100) * 0.8
        };
      } else {
        return {
          action: `Promoción temporal ${discountPct}% + campaña de marketing dirigida`,
          rationale: `Sin movimiento por ${Math.floor(daysNoSales)} días pero demanda estable. Estimular con promoción limitada.`,
          estimatedRecovery: inventoryValue * (1 - discountPct / 100)
        };
      }
    }

    // Overstock
    if (excessQty > 0) {
      const excessValue = excessQty * unitCost;
      if (excessValue > 20000) {
        return {
          action: `Venta B2B del exceso (${Math.floor(excessQty)} unidades) con ${discountPct}% descuento`,
          rationale: `Exceso significativo de Q${excessValue.toFixed(0)} sobre pronóstico. Canal mayorista para mover volumen.`,
          estimatedRecovery: excessValue * (1 - discountPct / 100)
        };
      } else {
        return {
          action: `Bundle promocional (2x1 o 3x2) para acelerar rotación`,
          rationale: `Exceso de ${Math.floor(excessQty)} unidades. Bundle incentiva compra de volumen sin percepción de producto en problemas.`,
          estimatedRecovery: excessValue * 0.85 // 85% recovery through bundles
        };
      }
    }

    // Default: Standard discount
    return {
      action: `Descuento estándar del ${discountPct}%`,
      rationale: `Optimización estándar para normalizar niveles de inventario.`,
      estimatedRecovery: inventoryValue * (1 - discountPct / 100)
    };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-member-access,@typescript-eslint/no-unsafe-assignment */
}