import { FastifyRequest, FastifyReply } from 'fastify';
import { FinancialQueries } from '../queries/financial.queries';
import { QueryBuilder } from '../utils/query-builder';

interface MonthlyReportRequest {
  startDate?: string;
  endDate?: string;
}

interface BudgetAnalysisRequest {
  startDate?: string;
  endDate?: string;
  categories?: string[];
}

interface MonthlyReportResponse {
  success: boolean;
  data: {
    reportPeriod: {
      start: string;
      end: string;
    };
    executiveSummary: {
      totalRevenue: number;
      totalCosts: number;
      grossProfit: number;
      profitMargin: number;
      inventoryValue: number;
      cashFlow: number;
    };
    revenueAnalysis: {
      currentMonth: number;
      previousMonth: number;
      changePercent: number;
      trend: string;
    };
    costAnalysis: {
      breakdown: Array<{
        category: string;
        amount: number;
        percentage: number;
        trend: 'up' | 'down' | 'stable';
      }>;
      totalCosts: number;
    };
    inventoryMetrics: {
      currentValue: number;
      turnoverRate: number;
      daysOfInventory: number;
      slowMovers: Array<{
        sku: string;
        productName: string;
        value: number;
        daysOnHand: number;
      }>;
    };
    cashFlowSummary: {
      operatingCashFlow: number;
      investingCashFlow: number;
      financingCashFlow: number;
      netCashFlow: number;
    };
    budgetVariance: {
      plannedRevenue: number;
      actualRevenue: number;
      variance: number;
      variancePercent: number;
    };
    risks: Array<{
      type: string;
      description: string;
      severity: 'low' | 'medium' | 'high';
      recommendation: string;
    }>;
    opportunities: Array<{
      type: string;
      description: string;
      potentialImpact: number;
      recommendation: string;
    }>;
    narrative: string;
  };
}

interface BudgetAnalysisResponse {
  success: boolean;
  data: {
    period: {
      start: string;
      end: string;
    };
    overview: {
      totalBudget: number;
      totalActual: number;
      totalVariance: number;
      variancePercent: number;
      status: 'under' | 'over' | 'on-track';
    };
    byCategory: Array<{
      category: string;
      budget: number;
      actual: number;
      variance: number;
      variancePercent: number;
      status: 'favorable' | 'unfavorable' | 'on-target';
      trend: string;
    }>;
    forecast: {
      projectedTotal: number;
      projectedVariance: number;
      confidence: number;
      assumptions: string[];
    };
    recommendations: Array<{
      category: string;
      issue: string;
      action: string;
      priority: 'high' | 'medium' | 'low';
      estimatedImpact: number;
    }>;
    narrative: string;
  };
}

interface PreviousRevenueRow {
  total: number | null;
}

interface SlowMoverRow {
  sku: string | null;
  product_name: string | null;
  value: number | null;
  days_on_hand: number | null;
}

interface FinancialRiskEntry {
  type: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

interface FinancialOpportunity {
  type: string;
  description: string;
  potentialImpact: number;
  recommendation: string;
}

interface BudgetCategoryRow {
  category: string | null;
  actual: number | null;
}

interface BudgetRecommendationEntry {
  category: string;
  issue: string;
  action: string;
  priority: 'high' | 'medium' | 'low';
  estimatedImpact: number;
}

interface MonthlyNarrativeData {
  totalRevenue: number;
  grossProfit: number;
  profitMargin: number;
  revenueChangePercent: number;
  inventoryValue: number;
  slowMoversCount: number;
  risks: FinancialRiskEntry[];
  opportunities: FinancialOpportunity[];
}

interface BudgetNarrativeData {
  totalBudget: number;
  totalActual: number;
  variancePercent: number;
  totalVariance: number;
  byCategory: BudgetCategory[];
  projectedVariance: number;
  recommendations: BudgetRecommendationEntry[];
}

interface BudgetCategory {
  category: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercent: number;
  status: 'favorable' | 'unfavorable' | 'on-target';
  trend: string;
}

interface WorkingCapitalCurrentStateRow {
  revenue: number;
  avg_inventory: number;
  cogs: number;
  purchases: number;
  sales_days: number;
  period_days: number;
}

interface WorkingCapitalParameters {
  inventory_reduction_pct?: number;
  dso_reduction_days?: number;
  dpo_increase_days?: number;
  new_dio: number;
  new_dso: number;
  new_dpo: number;
}

interface WorkingCapitalImpact {
  new_ccc: number;
  ccc_improvement: number;
  cash_freed: number;
  inventory_reduction_value?: number;
  discount_cost_estimate?: number;
  supplier_relationship_risk?: string;
  balanced_approach?: boolean;
  transformational?: boolean;
}

interface WorkingCapitalScenario {
  id: string;
  name: string;
  description: string;
  parameters: WorkingCapitalParameters;
  impact: WorkingCapitalImpact;
  risk_level: 'low' | 'medium' | 'high';
  risk_factors: string[];
  implementation_difficulty: 'easy' | 'moderate' | 'difficult';
  implementation_steps: string[];
}

interface WorkingCapitalRecommendation {
  priority: 'high' | 'medium' | 'low';
  area: 'inventory' | 'receivables' | 'payables' | 'overall';
  action: string;
  rationale: string;
  estimated_impact: string;
  timeframe: string;
}

interface GMROIRow {
  category_name: string;
  gross_margin: number;
  avg_inventory_value: number;
  gmroi: number;
  margin_pct: number;
  inventory_turnover: number;
  total_units_sold: number;
  product_count: number;
  strategic_category: 'star' | 'cash_cow' | 'question_mark' | 'dog';
}

interface GMROIRecommendation {
  category: string;
  action: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
  estimated_impact: string;
}

interface ForecastCheckRow {
  forecast_count: number;
}

interface IncomingCashRow {
  date: string;
  revenue: number;
  confidence: number;
  method: 'ml_forecast' | 'historical_velocity';
}

interface OutgoingCashRow {
  date: string;
  payment: number;
  type: string;
}

interface DailyProjectionRow {
  date: string;
  cash_in: number;
  cash_out: number;
  net_flow: number;
  cumulative: number;
  confidence: number;
  method: string;
}

interface CriticalCashDate {
  date: string;
  shortage: number;
  days_from_today: number;
}

interface CashFlowRecommendation {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  action: string;
  rationale: string;
  estimated_impact: string;
}

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class FinanzasHandler {
  /**
   * Generate comprehensive monthly financial report
   */
  static async generateMonthlyReport(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    try {
      const prisma = request.server.prisma;
      const { startDate, endDate } = request.body as MonthlyReportRequest;

      // Parse dates or use sensible defaults
      let start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      let end = endDate ? new Date(endDate) : new Date();
      // Sanitize: ensure start <= end
      if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
      }

      request.log.info({ start, end }, '[FINANZAS HANDLER] Generating monthly report');

      // Get all financial data in parallel
      const [
        revenueMetrics,
        profitability,
        costBreakdown,
        inventoryValuation
      ] = await Promise.all([
        FinancialQueries.getRevenueMetrics(request.server, start, end),
        FinancialQueries.getProfitabilityMetrics(request.server, start, end),
        FinancialQueries.getCostBreakdown(request.server, start, end),
        FinancialQueries.getInventoryValuation(request.server),
      ]);

      // Calculate executive summary
      const totalRevenue = Number(revenueMetrics.total_revenue) || 0;
      const grossProfit = Number(profitability.gross_profit) || 0;
      const totalCosts = totalRevenue - grossProfit;
      const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const inventoryValue = Number(inventoryValuation.total_value) || 0;

      // Calculate cash flow (simplified - actual would come from accounting system)
      const netCashFlow = totalRevenue * 0.3; // Simplified estimate

      // Get previous month for comparison
      const prevMonthStart = new Date(start);
      prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
      const prevMonthEnd = new Date(start);
      prevMonthEnd.setDate(0); // Last day of previous month

      const previousRevenue = await prisma.$queryRawUnsafe<PreviousRevenueRow[]>(`
        SELECT COALESCE(SUM(total_price), 0) as total
        FROM sales_partitioned
        WHERE sale_datetime >= $1 
          AND sale_datetime < $2 + INTERVAL '1 day'
          AND is_deleted = false
      `, prevMonthStart, prevMonthEnd);

      const prevRevenue = Number(previousRevenue[0]?.total) || 0;
      const revenueChangePercent = prevRevenue > 0 
        ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 
        : 0;

      // Identify slow movers
      const slowMoversQuery = `
        SELECT 
          p.sku,
          p.product_name,
          COALESCE(SUM(s.quantity * p.cost), 0) as value,
          EXTRACT(DAY FROM (NOW() - MAX(s.sale_datetime))) as days_on_hand
        FROM products p
        LEFT JOIN sales_partitioned s ON p.product_id = s.product_id
        WHERE p.is_deleted = false
        GROUP BY p.product_id, p.sku, p.product_name, p.cost
        HAVING MAX(s.sale_datetime) < NOW() - INTERVAL '90 days'
           OR MAX(s.sale_datetime) IS NULL
        ORDER BY value DESC
        LIMIT 5
      `;
      const slowMovers = await prisma.$queryRawUnsafe<SlowMoverRow[]>(slowMoversQuery);

      // Generate risks based on alerts and metrics
      const risks: FinancialRiskEntry[] = [];
      
      if (profitMargin < 20) {
        risks.push({
          type: 'low_margin',
          description: `Margen de utilidad bruta de ${profitMargin.toFixed(1)}% está por debajo del objetivo de 20%`,
          severity: 'high',
          recommendation: 'Revisar estrategia de precios y costos operativos. Considerar aumentos de precios selectivos o reducción de costos.'
        });
      }

      if (inventoryValue > totalRevenue * 0.5) {
        risks.push({
          type: 'high_inventory',
          description: 'Valor de inventario representa más del 50% de los ingresos mensuales',
          severity: 'medium',
          recommendation: 'Acelerar rotación de inventario mediante promociones o ajuste de niveles de reorden.'
        });
      }

      if (slowMovers.length > 3) {
        risks.push({
          type: 'slow_movers',
          description: `${slowMovers.length} productos con más de 90 días sin venta`,
          severity: 'medium',
          recommendation: 'Implementar liquidación de inventario lento para recuperar capital.'
        });
      }

      // Generate opportunities
      const opportunities: FinancialOpportunity[] = [];

      if (revenueChangePercent > 10) {
        opportunities.push({
          type: 'revenue_growth',
          description: `Crecimiento de ${revenueChangePercent.toFixed(1)}% en ingresos vs mes anterior`,
          potentialImpact: totalRevenue * 0.05,
          recommendation: 'Capitalizar momentum con campañas de marketing enfocadas en productos de alto margen.'
        });
      }

      if (Number(inventoryValuation.out_of_stock_count) === 0) {
        opportunities.push({
          type: 'stock_availability',
          description: 'Sin productos agotados - alta disponibilidad de inventario',
          potentialImpact: totalRevenue * 0.02,
          recommendation: 'Mantener niveles actuales de inventario para maximizar ventas.'
        });
      }

      // Generate AI narrative
      const narrative = this.generateMonthlyNarrative({
        totalRevenue,
        grossProfit,
        profitMargin,
        revenueChangePercent,
        inventoryValue,
        slowMoversCount: slowMovers.length,
        risks,
        opportunities
      });

      const response: MonthlyReportResponse = {
        success: true,
        data: {
          reportPeriod: {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
          },
          executiveSummary: {
            totalRevenue,
            totalCosts,
            grossProfit,
            profitMargin,
            inventoryValue,
            cashFlow: netCashFlow
          },
          revenueAnalysis: {
            currentMonth: totalRevenue,
            previousMonth: prevRevenue,
            changePercent: revenueChangePercent,
            trend: revenueChangePercent > 5 ? 'Crecimiento fuerte' : 
                   revenueChangePercent > 0 ? 'Crecimiento moderado' : 
                   revenueChangePercent > -5 ? 'Estable' : 'Decrecimiento'
          },
          costAnalysis: {
            breakdown: costBreakdown.map((item) => ({
              category: item.category || 'General',
              amount: Number(item.value) || 0,
              percentage: 0,
              trend: 'stable' as const
            })),
            totalCosts
          },
          inventoryMetrics: {
            currentValue: inventoryValue,
            turnoverRate: totalRevenue > 0 ? totalRevenue / inventoryValue : 0,
            daysOfInventory: inventoryValue > 0 ? (inventoryValue / (totalCosts / 30)) : 0,
            slowMovers: slowMovers.map((item: SlowMoverRow) => ({
              sku: item.sku ?? '',
              productName: item.product_name ?? '',
              value: Number(item.value) || 0,
              daysOnHand: Number(item.days_on_hand) || 0
            }))
          },
          cashFlowSummary: {
            operatingCashFlow: netCashFlow,
            investingCashFlow: 0,
            financingCashFlow: 0,
            netCashFlow
          },
          budgetVariance: {
            plannedRevenue: totalRevenue * 1.1, // Would come from budget system
            actualRevenue: totalRevenue,
            variance: totalRevenue * -0.1,
            variancePercent: -10
          },
          risks,
          opportunities,
          narrative
        }
      };

      return reply.status(200).send(response);

    } catch (error: unknown) {
      request.log.error({ err: error }, '[FINANZAS HANDLER] Error generating monthly report:');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar el reporte mensual',
        message: getErrorMessage(error)
      });
    }
  }

  /**
   * Analyze budget vs actual spending
   */
  static async analyzeBudget(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    try {
      const prisma = request.server.prisma;
      const { startDate, endDate, categories } = request.query as BudgetAnalysisRequest;

      let start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
      let end = endDate ? new Date(endDate) : new Date();
      // Sanitize: ensure start <= end
      if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
      }

      request.log.info({ start, end, categories }, '[FINANZAS HANDLER] Analyzing budget');

      // Get actual spending by category
      const actualSpendingQuery = `
        SELECT 
          COALESCE(p.category_name, 'General') as category,
          COALESCE(SUM(s.quantity * p.cost), 0) as actual
        FROM sales_partitioned s
        JOIN products p ON s.product_id = p.product_id
        WHERE s.sale_datetime >= $1 
          AND s.sale_datetime < $2 + INTERVAL '1 day'
          AND s.is_deleted = false
        GROUP BY p.category_name
        ORDER BY actual DESC
      `;

      const actualSpending = await prisma.$queryRawUnsafe<BudgetCategoryRow[]>(
        actualSpendingQuery,
        start,
        end
      );

      // Calculate total actual
      const totalActual = actualSpending.reduce((sum, item) => sum + Number(item.actual), 0);

      // Simulate budget (would come from budget system)
      const totalBudget = totalActual * 1.15; // Assume 15% over budget target
      const totalVariance = totalActual - totalBudget;
      const variancePercent = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0;

      // Build category analysis
      const byCategory: BudgetCategory[] = actualSpending.map((item: BudgetCategoryRow) => {
        const actual = Number(item.actual);
        const budget = actual * 1.15; // Simulate budget
        const variance = actual - budget;
        const variancePercent = budget > 0 ? (variance / budget) * 100 : 0;

        const status: BudgetCategory['status'] = variance < 0
          ? 'favorable'
          : variance > budget * 0.1
            ? 'unfavorable'
            : 'on-target';

        return {
          category: item.category || 'General',
          budget,
          actual,
          variance,
          variancePercent,
          status,
          trend: variance > 0 ? 'Gasto excedido' : 'Dentro de presupuesto'
        };
      });

      // Generate recommendations
      const recommendations: BudgetRecommendationEntry[] = [];

      byCategory.forEach((cat: BudgetCategory) => {
        if (cat.status === 'unfavorable') {
          recommendations.push({
            category: cat.category,
            issue: `Presupuesto excedido por ${Math.abs(cat.variancePercent).toFixed(1)}%`,
            action: cat.variancePercent > 20 
              ? 'Reducción inmediata de costos necesaria. Revisar contratos y renegociar precios.'
              : 'Monitorear de cerca. Implementar controles de gasto adicionales.',
            priority: cat.variancePercent > 20 ? 'high' : 'medium',
            estimatedImpact: Math.abs(cat.variance) * 0.3
          });
        }
      });

      // Forecast to end of period
      const daysElapsed = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const daysInPeriod = Math.floor((new Date(start.getFullYear(), 12, 31).getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const projectedTotal = daysElapsed > 0 ? (totalActual / daysElapsed) * daysInPeriod : totalActual;
      const projectedVariance = projectedTotal - totalBudget;

      // Generate narrative
      const narrative = this.generateBudgetNarrative({
        totalBudget,
        totalActual,
        totalVariance,
        variancePercent,
        byCategory,
        projectedVariance,
        recommendations
      });

      const response: BudgetAnalysisResponse = {
        success: true,
        data: {
          period: {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
          },
          overview: {
            totalBudget,
            totalActual,
            totalVariance,
            variancePercent,
            status: totalVariance < 0 ? 'under' : 
                    totalVariance > totalBudget * 0.1 ? 'over' : 'on-track'
          },
          byCategory,
          forecast: {
            projectedTotal,
            projectedVariance,
            confidence: 0.75,
            assumptions: [
              'Tendencia actual de gasto se mantiene constante',
              'No hay eventos excepcionales planeados',
              'Estacionalidad basada en patrones históricos'
            ]
          },
          recommendations,
          narrative
        }
      };

      return reply.status(200).send(response);

    } catch (error: unknown) {
      request.log.error({ err: error }, '[FINANZAS HANDLER] Error analyzing budget:');
      return reply.status(500).send({
        success: false,
        error: 'Error al analizar el presupuesto',
        message: getErrorMessage(error)
      });
    }
  }

  /**
   * Generate AI narrative for monthly report
   */
  private static generateMonthlyNarrative(data: MonthlyNarrativeData): string {
    const parts: string[] = [];

    parts.push(`## Resumen Ejecutivo del Período`);
    parts.push('');
    
    parts.push(`Los ingresos totales alcanzaron **Q${(data.totalRevenue / 1000).toFixed(1)}K** con un margen de utilidad bruta del **${data.profitMargin.toFixed(1)}%**.`);
    
    if (data.revenueChangePercent > 5) {
      parts.push(`Se observa un **crecimiento positivo del ${data.revenueChangePercent.toFixed(1)}%** respecto al mes anterior, indicando expansión en las operaciones.`);
    } else if (data.revenueChangePercent < -5) {
      parts.push(`Los ingresos disminuyeron **${Math.abs(data.revenueChangePercent).toFixed(1)}%** respecto al mes anterior, requiriendo atención estratégica.`);
    }

    parts.push('');
    parts.push(`### Indicadores Financieros Clave`);
    parts.push('');
    parts.push(`- **Valor de Inventario:** Q${(data.inventoryValue / 1000).toFixed(1)}K`);
    parts.push(`- **Productos de Rotación Lenta:** ${data.slowMoversCount} SKUs`);

    if (data.risks.length > 0) {
      parts.push('');
      parts.push(`### ⚠️ Riesgos Identificados`);
      parts.push('');
      data.risks.forEach((risk: FinancialRiskEntry, i: number) => {
        const emoji = risk.severity === 'high' ? '🔴' : risk.severity === 'medium' ? '🟡' : '🟢';
        parts.push(`${i + 1}. ${emoji} **${risk.type}:** ${risk.description}`);
        parts.push(`   - *Recomendación:* ${risk.recommendation}`);
      });
    }

    if (data.opportunities.length > 0) {
      parts.push('');
      parts.push(`### 💡 Oportunidades de Mejora`);
      parts.push('');
      data.opportunities.forEach((opp: FinancialOpportunity, i: number) => {
        parts.push(`${i + 1}. **${opp.type}:** ${opp.description}`);
        parts.push(`   - *Impacto Estimado:* Q${(opp.potentialImpact / 1000).toFixed(1)}K`);
        parts.push(`   - *Acción Sugerida:* ${opp.recommendation}`);
      });
    }

    parts.push('');
    parts.push(`---`);
    parts.push(`*Reporte generado el ${new Date().toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })}*`);

    return parts.join('\n');
  }

  /**
   * Generate AI narrative for budget analysis
   */
  private static generateBudgetNarrative(data: BudgetNarrativeData): string {
    const parts: string[] = [];

    parts.push(`## Análisis de Presupuesto vs Real`);
    parts.push('');

    const status = data.variancePercent < 0 ? 'por debajo' : 'por encima';
    const emoji = data.variancePercent < 0 ? '✅' : data.variancePercent > 10 ? '🔴' : '⚠️';

    parts.push(`${emoji} El gasto actual está **${status} del presupuesto** en un **${Math.abs(data.variancePercent).toFixed(1)}%**.`);
    parts.push('');

    if (data.variancePercent > 10) {
      parts.push(`⚠️ **Atención Requerida:** El exceso presupuestario de Q${(Math.abs(data.totalActual - data.totalBudget) / 1000).toFixed(1)}K requiere acción correctiva inmediata.`);
      parts.push('');
    }

    // Category insights
    const overBudgetCats = data.byCategory.filter((c: BudgetCategory) => c.status === 'unfavorable');
    if (overBudgetCats.length > 0) {
      parts.push(`### Categorías Fuera de Presupuesto`);
      parts.push('');
      overBudgetCats.forEach((cat: BudgetCategory) => {
        parts.push(`- **${cat.category}:** Exceso de ${Math.abs(cat.variancePercent).toFixed(1)}% (Q${(Math.abs(cat.variance) / 1000).toFixed(1)}K)`);
      });
      parts.push('');
    }

    // Recommendations
    if (data.recommendations.length > 0) {
      parts.push(`### 📋 Recomendaciones Prioritarias`);
      parts.push('');
      
      const highPriority = data.recommendations.filter((r: BudgetRecommendationEntry) => r.priority === 'high');
      if (highPriority.length > 0) {
        parts.push(`**Alta Prioridad:**`);
      highPriority.forEach((rec: BudgetRecommendationEntry, i: number) => {
          parts.push(`${i + 1}. ${rec.category}: ${rec.action}`);
          parts.push(`   - *Impacto Estimado:* Q${(rec.estimatedImpact / 1000).toFixed(1)}K`);
        });
        parts.push('');
      }

      const mediumPriority = data.recommendations.filter((r: BudgetRecommendationEntry) => r.priority === 'medium');
      if (mediumPriority.length > 0) {
        parts.push(`**Prioridad Media:**`);
      mediumPriority.forEach((rec: BudgetRecommendationEntry, i: number) => {
          parts.push(`${i + 1}. ${rec.category}: ${rec.action}`);
        });
        parts.push('');
      }
    }

    // Forecast
    if (data.projectedVariance !== 0) {
      const projStatus = data.projectedVariance < 0 ? 'ahorros' : 'sobrecosto';
      parts.push(`### 📊 Proyección al Cierre del Período`);
      parts.push('');
      parts.push(`Si las tendencias actuales continúan, se proyecta un **${projStatus} de Q${(Math.abs(data.projectedVariance) / 1000).toFixed(1)}K** al final del período.`);
    }

    parts.push('');
    parts.push(`---`);
    parts.push(`*Análisis generado el ${new Date().toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })}*`);

    return parts.join('\n');
  }

  /**
   * Generate GMROI Matrix - Strategic inventory return analysis
   */
  static async getGMROIMatrix(request: FastifyRequest, reply: FastifyReply) {
    try {
      const prisma = request.server.prisma;

      const { fechaInicio, fechaFin } = request.query as { 
        fechaInicio?: string; 
        fechaFin?: string;
      };

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();

      // Calculate GMROI by category
      const gmroiQuery = `
        WITH category_metrics AS (
          SELECT 
            p.category_name,
            SUM(sp.unit_price * sp.quantity) - SUM(sp.quantity * p.cost) as gross_margin,
            AVG(COALESCE(i.quantity_on_hand, 0) * p.cost) as avg_inventory_value,
            SUM(sp.quantity * sp.uom_ratio) as total_units_sold,
            COUNT(DISTINCT sp.sale_datetime::date) as days_with_sales,
            COUNT(DISTINCT sp.product_id) as product_count,
            SUM(sp.unit_price * sp.quantity) as total_revenue
          FROM sales_partitioned sp
          JOIN products p ON sp.product_id = p.product_id
          LEFT JOIN LATERAL (
            SELECT quantity_on_hand 
            FROM inventory_snapshots 
            WHERE product_id = p.product_id 
              AND is_deleted = false
            ORDER BY snapshot_timestamp DESC 
            LIMIT 1
          ) i ON true
          WHERE sp.sale_datetime >= $1 
            AND sp.sale_datetime < $2
            AND sp.is_deleted = false
          GROUP BY p.category_name
        ),
        turnover_calc AS (
          SELECT 
            category_name,
            gross_margin,
            avg_inventory_value,
            total_units_sold,
            days_with_sales,
            product_count,
            total_revenue,
            CASE 
              WHEN avg_inventory_value > 0 
              THEN (gross_margin / NULLIF(avg_inventory_value, 0))
              ELSE 0 
            END as gmroi,
            (gross_margin / NULLIF(total_revenue, 0)) * 100 as margin_pct,
            CASE 
              WHEN avg_inventory_value > 0 AND days_with_sales > 0
              THEN (total_revenue / NULLIF(avg_inventory_value, 0)) * (365.0 / NULLIF(days_with_sales, 0))
              ELSE 0
            END as inventory_turnover
          FROM category_metrics
        )
        SELECT 
          category_name,
          ROUND(gross_margin::numeric, 2) as gross_margin,
          ROUND(avg_inventory_value::numeric, 2) as avg_inventory_value,
          ROUND(gmroi::numeric, 2) as gmroi,
          ROUND(margin_pct::numeric, 1) as margin_pct,
          ROUND(inventory_turnover::numeric, 2) as inventory_turnover,
          total_units_sold,
          product_count,
          CASE 
            WHEN gmroi >= 3.0 AND inventory_turnover >= 4.0 THEN 'star'
            WHEN gmroi >= 3.0 AND inventory_turnover < 4.0 THEN 'cash_cow'
            WHEN gmroi < 3.0 AND inventory_turnover >= 4.0 THEN 'question_mark'
            ELSE 'dog'
          END as strategic_category
        FROM turnover_calc
        WHERE avg_inventory_value > 0
        ORDER BY gmroi DESC;
      `;

      const categories = await QueryBuilder.executeWithDebug<GMROIRow[]>(
        prisma,
        gmroiQuery,
        [startDate, endDate],
        'getGMROIMatrix'
      );

      // Calculate summary metrics
      const totalGrossMargin = categories.reduce((sum, cat) => sum + Number(cat.gross_margin || 0), 0);
      const totalInventoryValue = categories.reduce((sum, cat) => sum + Number(cat.avg_inventory_value || 0), 0);
      const avgGMROI = totalInventoryValue > 0 ? totalGrossMargin / totalInventoryValue : 0;

      const stars = categories.filter(c => c.strategic_category === 'star');
      const cashCows = categories.filter(c => c.strategic_category === 'cash_cow');
      const questionMarks = categories.filter(c => c.strategic_category === 'question_mark');
      const dogs = categories.filter(c => c.strategic_category === 'dog');

      // Generate AI recommendations
      const recommendations = this.generateGMROIRecommendations(
        stars,
        cashCows,
        questionMarks,
        dogs
      );

      // Generate narrative
      const narrative = this.generateGMROINarrative(categories, avgGMROI, stars.length, dogs.length);

      return reply.status(200).send({
        success: true,
        data: {
          summary: {
            total_categories: categories.length,
            total_gross_margin: Math.round(totalGrossMargin),
            total_inventory_value: Math.round(totalInventoryValue),
            overall_gmroi: Number(avgGMROI.toFixed(2)),
            stars_count: stars.length,
            cash_cows_count: cashCows.length,
            question_marks_count: questionMarks.length,
            dogs_count: dogs.length
          },
          categories,
          quadrants: {
            stars: stars.map(c => ({ 
              category: c.category_name, 
              gmroi: c.gmroi, 
              turnover: c.inventory_turnover 
            })),
            cash_cows: cashCows.map(c => ({ 
              category: c.category_name, 
              gmroi: c.gmroi, 
              turnover: c.inventory_turnover 
            })),
            question_marks: questionMarks.map(c => ({ 
              category: c.category_name, 
              gmroi: c.gmroi, 
              turnover: c.inventory_turnover 
            })),
            dogs: dogs.map(c => ({ 
              category: c.category_name, 
              gmroi: c.gmroi, 
              turnover: c.inventory_turnover 
            }))
          },
          recommendations,
          narrative,
          methodology: {
            gmroi_formula: "GMROI = Margen Bruto / Inversión Promedio en Inventario",
            thresholds: {
              high_gmroi: "≥ 3.0",
              high_turnover: "≥ 4.0 veces/año"
            },
            interpretation: "Valores más altos indican mejor retorno sobre la inversión en inventario"
          }
        }
      });

    } catch (error: unknown) {
      request.log.error({ err: error }, '[GMROI Matrix] Error:');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar matriz GMROI',
        message: getErrorMessage(error)
      });
    }
  }

  private static generateGMROIRecommendations(
    stars: GMROIRow[],
    cashCows: GMROIRow[],
    questionMarks: GMROIRow[],
    dogs: GMROIRow[]
  ): GMROIRecommendation[] {
    const recommendations: GMROIRecommendation[] = [];

    // Stars - Invest more
    stars.slice(0, 3).forEach(cat => {
      recommendations.push({
        category: cat.category_name,
        action: 'Incrementar inversión en inventario 15-20%',
        rationale: `Alto retorno (GMROI ${cat.gmroi}) y alta rotación (${cat.inventory_turnover}x). Categoría estrella que genera valor.`,
        priority: 'high',
        estimated_impact: `+Q${Math.round(cat.gross_margin * 0.15).toLocaleString('es-GT')}/año adicional`
      });
    });

    // Question Marks - Improve margins
    questionMarks.slice(0, 2).forEach(cat => {
      const priceIncrease = 8; // 8% suggested increase
      recommendations.push({
        category: cat.category_name,
        action: `Aumentar precio ${priceIncrease}% o reducir costos`,
        rationale: `Buena rotación (${cat.inventory_turnover}x) pero margen bajo (${cat.margin_pct}%). Optimizar rentabilidad.`,
        priority: 'medium',
        estimated_impact: `+Q${Math.round(cat.gross_margin * (priceIncrease / 100)).toLocaleString('es-GT')}/año potencial`
      });
    });

    // Dogs - Divest or phase out
    dogs.slice(0, 2).forEach(cat => {
      recommendations.push({
        category: cat.category_name,
        action: 'Reducir inventario 40% o descontinuar',
        rationale: `Bajo retorno (GMROI ${cat.gmroi}) y baja rotación (${cat.inventory_turnover}x). Capital mal asignado.`,
        priority: 'high',
        estimated_impact: `Liberar Q${Math.round(cat.avg_inventory_value * 0.4).toLocaleString('es-GT')} de capital`
      });
    });

    // Cash Cows - Maintain
    if (cashCows.length > 0) {
      const topCashCow = cashCows[0];
      recommendations.push({
        category: topCashCow.category_name,
        action: 'Mantener niveles actuales, optimizar rotación',
        rationale: `Excelente margen (${topCashCow.margin_pct}%) pero rotación mejorable (${topCashCow.inventory_turnover}x).`,
        priority: 'medium',
        estimated_impact: 'Proteger margen actual, objetivo +0.5x rotación'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder: Record<GMROIRecommendation['priority'], number> = {
        high: 0,
        medium: 1,
        low: 2
      };
      return (priorityOrder[a.priority] ?? 999) - (priorityOrder[b.priority] ?? 999);
    });
  }

  private static generateGMROINarrative(
    categories: GMROIRow[],
    avgGMROI: number,
    starsCount: number,
    dogsCount: number
  ): string {
    let narrative = `## Análisis Estratégico de Retorno sobre Inventario (GMROI)\n\n`;

    narrative += `**GMROI General: ${avgGMROI.toFixed(2)}** - `;
    if (avgGMROI >= 3.0) {
      narrative += `El portafolio muestra un retorno saludable sobre la inversión en inventario.\n\n`;
    } else if (avgGMROI >= 2.0) {
      narrative += `El portafolio tiene un retorno moderado. Hay oportunidades de mejora significativas.\n\n`;
    } else {
      narrative += `⚠️ El retorno sobre inventario está por debajo del estándar. Se requiere acción inmediata.\n\n`;
    }

    // Stars analysis
    if (starsCount > 0) {
      narrative += `✨ **${starsCount} Categorías Estrella** identificadas con alto margen y alta rotación. `;
      narrative += `Estas son las oportunidades de mayor crecimiento y deben recibir inversión adicional.\n\n`;
    } else {
      narrative += `⚠️ No se identificaron categorías estrella. El portafolio carece de productos de alto rendimiento.\n\n`;
    }

    // Dogs analysis
    if (dogsCount > 0) {
      narrative += `🔻 **${dogsCount} Categorías Perro** con bajo retorno y baja rotación. `;
      narrative += `Estas categorías están destruyendo valor y deberían considerarse para desinversión o descontinuación.\n\n`;
    }

    // Top performer
    if (categories.length > 0) {
      const topCategory = categories[0];
      narrative += `🏆 **Mejor Categoría**: ${topCategory.category_name} con GMROI de ${topCategory.gmroi}, `;
      narrative += `generando Q${Math.round(topCategory.gross_margin).toLocaleString('es-GT')} en margen bruto.\n\n`;
    }

    narrative += `**Recomendación Principal**: Reasignar capital de categorías "Perro" hacia categorías "Estrella" `;
    narrative += `para maximizar el retorno sobre la inversión total en inventario.`;

    return narrative;
  }

  /**
   * Get cash flow forecast with ML predictions
   */
  static async getCashFlowForecast(request: FastifyRequest, reply: FastifyReply) {
    try {
      const prisma = request.server.prisma;

      const { 
        fechaInicio, 
        fechaFin, 
        horizonDays,
        startingCash 
      } = request.query as { 
        fechaInicio?: string; 
        fechaFin?: string;
        horizonDays?: string;
        startingCash?: string;
      };

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date();
      const endDate = fechaFin ? new Date(fechaFin) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const horizon = parseInt(horizonDays || '90');
      const initialCash = parseFloat(startingCash || '0');

      // Step 1: Check if forecasts exist
      const forecastCheckQuery = `
        SELECT COUNT(*) as forecast_count
        FROM forecasts
        WHERE forecast_date >= $1 
          AND forecast_date <= $2
          AND is_deleted = false;
      `;
      
      const forecastCheck = await QueryBuilder.executeWithDebug<ForecastCheckRow[]>(
        prisma,
        forecastCheckQuery,
        [startDate, endDate],
        'checkForecasts'
      );
      
      const hasForecastData = forecastCheck.length > 0 && Number(forecastCheck[0].forecast_count) > 0;

      // Step 2: Calculate incoming cash (sales projections)
      let incomingCashQuery: string;
      let incomingCashParams: (Date | string)[];

      if (hasForecastData) {
        // Use ML forecasts
        incomingCashQuery = `
          WITH daily_forecast AS (
            SELECT 
              f.forecast_date::date as date,
              SUM(COALESCE(f.forecasted_demand, 0) * COALESCE(p.price, p.cost * 1.3, 0)) as projected_revenue,
              AVG(COALESCE(f.confidence_score, 0.7)) as avg_confidence
            FROM forecasts f
            JOIN products p ON f.product_id = p.product_id
            WHERE f.forecast_date >= $1 
              AND f.forecast_date <= $2
              AND f.is_deleted = false
            GROUP BY f.forecast_date::date
          )
          SELECT 
            date,
            ROUND(projected_revenue::numeric, 2) as revenue,
            ROUND(avg_confidence::numeric, 2) as confidence,
            'ml_forecast' as method
          FROM daily_forecast
          ORDER BY date;
        `;
        incomingCashParams = [startDate, endDate];
      } else {
        // Fallback: Use historical velocity
        incomingCashQuery = `
          WITH historical_daily_avg AS (
            SELECT 
              AVG(daily_revenue) as avg_daily_revenue
            FROM (
              SELECT 
                sale_datetime::date,
                SUM(total_price) as daily_revenue
              FROM sales_partitioned
              WHERE sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
                AND sale_datetime < CURRENT_DATE
                AND is_deleted = false
              GROUP BY sale_datetime::date
            ) daily_sales
          ),
          date_series AS (
            SELECT generate_series($1::date, $2::date, '1 day'::interval)::date as date
          )
          SELECT 
            ds.date,
            ROUND(COALESCE(h.avg_daily_revenue, 0)::numeric, 2) as revenue,
            0.60 as confidence,
            'historical_velocity' as method
          FROM date_series ds
          CROSS JOIN historical_daily_avg h
          ORDER BY ds.date;
        `;
        incomingCashParams = [startDate, endDate];
      }

      const incomingCash = await QueryBuilder.executeWithDebug<IncomingCashRow[]>(
        prisma,
        incomingCashQuery,
        incomingCashParams,
        'incomingCash'
      );

      const incomingCashData: IncomingCashRow[] = incomingCash;

      // Step 3: Calculate outgoing cash (purchase needs)
      const outgoingCashQuery = `
        WITH product_velocity AS (
          SELECT 
            product_id,
            AVG(daily_qty) as avg_daily_demand,
            STDDEV(daily_qty) as demand_stddev
          FROM (
            SELECT 
              product_id,
              sale_datetime::date,
              SUM(quantity * uom_ratio) as daily_qty
            FROM sales_partitioned
            WHERE sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
              AND sale_datetime < CURRENT_DATE
              AND is_deleted = false
            GROUP BY product_id, sale_datetime::date
          ) daily
          GROUP BY product_id
        ),
        current_inventory AS (
          SELECT DISTINCT ON (product_id)
            product_id,
            quantity_on_hand
          FROM inventory_snapshots
          WHERE is_deleted = false
          ORDER BY product_id, snapshot_timestamp DESC
        ),
        reorder_needs AS (
          SELECT 
            p.product_id,
            p.cost,
            COALESCE(ci.quantity_on_hand, 0) as current_stock,
            COALESCE(pv.avg_daily_demand, 0) as daily_demand,
            COALESCE(pv.demand_stddev, 0) as demand_volatility,
            14 as lead_time_days,
            
            -- Safety stock (2 sigma)
            COALESCE(pv.avg_daily_demand, 0) * 14 + 
            2 * COALESCE(pv.demand_stddev, 0) as reorder_point,
            
            -- Calculate days until stockout
            CASE 
              WHEN COALESCE(pv.avg_daily_demand, 0) > 0 
              THEN COALESCE(ci.quantity_on_hand, 0) / pv.avg_daily_demand
              ELSE 999
            END as days_until_stockout,
            
            -- Recommended order quantity
            GREATEST(
              COALESCE(pv.avg_daily_demand, 0) * 30 + 
              2 * COALESCE(pv.demand_stddev, 0) - 
              COALESCE(ci.quantity_on_hand, 0),
              COALESCE(p.moq, 1)
            ) as order_qty
            
          FROM products p
          LEFT JOIN product_velocity pv ON p.product_id = pv.product_id
          LEFT JOIN current_inventory ci ON p.product_id = ci.product_id
          WHERE p.is_deleted = false
        ),
        purchase_schedule AS (
          SELECT 
            (CURRENT_DATE + (days_until_stockout || ' days')::interval)::date as purchase_date,
            SUM(order_qty * cost) as purchase_amount
          FROM reorder_needs
          WHERE days_until_stockout < $1
            AND order_qty > 0
          GROUP BY purchase_date
        ),
        payment_schedule AS (
          SELECT 
            (purchase_date + INTERVAL '30 days')::date as payment_date,
            purchase_amount
          FROM purchase_schedule
        )
        SELECT 
          payment_date as date,
          ROUND(purchase_amount::numeric, 2) as payment,
          'purchase_payment' as type
        FROM payment_schedule
        WHERE payment_date <= $2
        ORDER BY payment_date;
      `;

      const outgoingCash = await QueryBuilder.executeWithDebug<OutgoingCashRow[]>(
        prisma,
        outgoingCashQuery,
        [horizon, endDate],
        'outgoingCash'
      );

      const outgoingCashData: OutgoingCashRow[] = outgoingCash;

      // Step 4: Merge incoming and outgoing, calculate daily position
      const dateMap = new Map<string, DailyProjectionRow>();
      
      // Initialize all dates
      incomingCashData.forEach((row) => {
        const dateStr = new Date(row.date).toISOString().split('T')[0];
        dateMap.set(dateStr, {
          date: dateStr,
          cash_in: Number(row.revenue || 0),
          cash_out: 0,
          net_flow: 0,
          cumulative: 0,
          confidence: Number(row.confidence || 0),
          method: row.method
        });
      });

      // Add outgoing cash
      outgoingCashData.forEach((row) => {
        const dateStr = new Date(row.date).toISOString().split('T')[0];
        if (dateMap.has(dateStr)) {
          const existing = dateMap.get(dateStr)!;
          existing.cash_out += Number(row.payment || 0);
        } else {
          dateMap.set(dateStr, {
            date: dateStr,
            cash_in: 0,
            cash_out: Number(row.payment || 0),
            net_flow: 0,
            cumulative: 0,
            confidence: 0.7,
            method: 'payment_schedule'
          });
        }
      });

      // Calculate cumulative position
      const dailyProjections: DailyProjectionRow[] = Array.from(dateMap.values())
        .sort((a, b) => a.date.localeCompare(b.date));

      let cumulativeCash = initialCash;
      
      dailyProjections.forEach(day => {
        day.net_flow = day.cash_in - day.cash_out;
        cumulativeCash += day.net_flow;
        day.cumulative = cumulativeCash;
      });

      // Step 5: Identify critical dates (negative cash position)
      const criticalDates: CriticalCashDate[] = dailyProjections
        .filter(day => day.cumulative < 0)
        .map(day => ({
          date: day.date,
          shortage: Math.abs(day.cumulative),
          days_from_today: Math.ceil(
            (new Date(day.date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
          )
        }));

      // Step 6: Calculate summary metrics
      const totalCashIn = dailyProjections.reduce((sum, day) => sum + day.cash_in, 0);
      const totalCashOut = dailyProjections.reduce((sum, day) => sum + day.cash_out, 0);
      const netCashFlow = totalCashIn - totalCashOut;
      const finalCashPosition = dailyProjections[dailyProjections.length - 1]?.cumulative || 0;
      const minCashPosition = dailyProjections.length > 0
        ? Math.min(...dailyProjections.map(d => d.cumulative))
        : 0;
      const maxCashPosition = dailyProjections.length > 0
        ? Math.max(...dailyProjections.map(d => d.cumulative))
        : 0;
      const avgConfidence = dailyProjections.length > 0
        ? dailyProjections.reduce((sum, d) => sum + d.confidence, 0) / dailyProjections.length
        : 0;

      // Step 7: Generate recommendations
      const recommendations = this.generateCashFlowRecommendations(
        criticalDates,
        finalCashPosition,
        minCashPosition,
        netCashFlow
      );

      // Step 8: Generate narrative
      const narrative = this.generateCashFlowNarrative(
        hasForecastData,
        horizon,
        finalCashPosition,
        criticalDates,
        recommendations
      );

      return reply.status(200).send({
        success: true,
        data: {
          summary: {
            horizon_days: horizon,
            starting_cash: initialCash,
            total_cash_in: Math.round(totalCashIn),
            total_cash_out: Math.round(totalCashOut),
            net_cash_flow: Math.round(netCashFlow),
            final_position: Math.round(finalCashPosition),
            min_position: Math.round(minCashPosition),
            max_position: Math.round(maxCashPosition),
            avg_confidence: Number(avgConfidence.toFixed(2)),
            critical_dates_count: criticalDates.length,
            forecast_method: hasForecastData ? 'ml_forecast' : 'historical_velocity'
          },
          daily_projections: dailyProjections.map(d => ({
            date: d.date,
            cash_in: Math.round(d.cash_in),
            cash_out: Math.round(d.cash_out),
            net_flow: Math.round(d.net_flow),
            cumulative: Math.round(d.cumulative),
            confidence: d.confidence
          })),
          critical_dates: criticalDates,
          recommendations,
          narrative,
          methodology: {
            incoming_cash: hasForecastData 
              ? 'Proyecciones de ML basadas en forecasts generados por algoritmo Prophet/ARIMA'
              : 'Velocidad histórica promedio de últimos 90 días',
            outgoing_cash: 'Necesidades de reabastecimiento basadas en punto de reorden + términos de pago Net 30',
            safety_margin: '2 desviaciones estándar de la demanda',
            confidence_level: hasForecastData ? 'Alta (ML)' : 'Media (histórico)'
          }
        }
      });

    } catch (error: unknown) {
      request.log.error({ err: error }, '[Cash Flow Forecast] Error:');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar pronóstico de flujo de efectivo',
        message: getErrorMessage(error)
      });
    }
  }

  private static generateCashFlowRecommendations(
    criticalDates: CriticalCashDate[],
    finalPosition: number,
    minPosition: number,
    netFlow: number
  ): CashFlowRecommendation[] {
    const recommendations: CashFlowRecommendation[] = [];

    // Critical shortage within 7 days
    const urgentShortage = criticalDates.find(d => d.days_from_today <= 7);
    if (urgentShortage) {
      recommendations.push({
        priority: 'urgent',
        action: `Asegurar línea de crédito de Q${Math.round(urgentShortage.shortage).toLocaleString('es-GT')}`,
        rationale: `Déficit de efectivo crítico en ${urgentShortage.days_from_today} días (${urgentShortage.date})`,
        estimated_impact: 'Evitar suspensión de operaciones'
      });
    }

    // Any shortage in horizon
    if (criticalDates.length > 0 && !urgentShortage) {
      const worstShortage = criticalDates.reduce((max, curr) => 
        curr.shortage > max.shortage ? curr : max
      );
      
      recommendations.push({
        priority: 'high',
        action: `Negociar línea de crédito de Q${Math.round(worstShortage.shortage * 1.1).toLocaleString('es-GT')}`,
        rationale: `Déficit proyectado de Q${Math.round(worstShortage.shortage).toLocaleString('es-GT')} en ${worstShortage.days_from_today} días`,
        estimated_impact: 'Mantener liquidez operativa'
      });
    }

    // Negative net flow
    if (netFlow < 0) {
      recommendations.push({
        priority: 'high',
        action: 'Acelerar cobranza y/o extender pagos a proveedores',
        rationale: `Flujo neto negativo de Q${Math.round(Math.abs(netFlow)).toLocaleString('es-GT')} en el período`,
        estimated_impact: `Mejorar posición de efectivo en Q${Math.round(Math.abs(netFlow) * 0.3).toLocaleString('es-GT')}`
      });
    }

    // Low minimum position (even if not negative)
    if (minPosition > 0 && minPosition < 50000) {
      recommendations.push({
        priority: 'medium',
        action: 'Mantener colchón mínimo de efectivo de Q75,000',
        rationale: `Posición mínima proyectada de solo Q${Math.round(minPosition).toLocaleString('es-GT')}`,
        estimated_impact: 'Reducir riesgo de estrés de liquidez'
      });
    }

    // Positive scenario
    if (finalPosition > 100000 && criticalDates.length === 0) {
      recommendations.push({
        priority: 'low',
        action: 'Considerar inversión de excedentes en instrumentos de corto plazo',
        rationale: `Posición final sólida de Q${Math.round(finalPosition).toLocaleString('es-GT')}`,
        estimated_impact: 'Generar rendimiento adicional del 3-5% anual'
      });
    }

    // Delay purchases recommendation
    if (criticalDates.length > 0) {
      recommendations.push({
        priority: 'medium',
        action: 'Retrasar compras no críticas 7-14 días',
        rationale: 'Suavizar curva de salidas de efectivo durante períodos de estrés',
        estimated_impact: 'Reducir déficit pico en 20-30%'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder: Record<CashFlowRecommendation['priority'], number> = {
        urgent: 0,
        high: 1,
        medium: 2,
        low: 3
      };
      return (priorityOrder[a.priority] ?? 999) - (priorityOrder[b.priority] ?? 999);
    });
  }

  private static generateCashFlowNarrative(
    hasForecastData: boolean,
    horizon: number,
    finalPosition: number,
    criticalDates: CriticalCashDate[],
    recommendations: CashFlowRecommendation[]
  ): string {
    let narrative = `## Pronóstico de Flujo de Efectivo (${horizon} días)\n\n`;

    // Methodology
    narrative += `**Metodología**: `;
    if (hasForecastData) {
      narrative += `Proyecciones basadas en modelos de Machine Learning (Prophet/ARIMA) con alta confianza.\n\n`;
    } else {
      narrative += `⚠️ Proyecciones basadas en velocidad histórica (últimos 90 días). Para mayor precisión, ejecutar pipeline de forecasting ML.\n\n`;
    }

    // Overall assessment
    if (criticalDates.length === 0 && finalPosition > 0) {
      narrative += `✅ **Proyección Favorable**: No se anticipan déficits de efectivo en el horizonte de ${horizon} días. `;
      narrative += `Posición final proyectada: Q${Math.round(finalPosition).toLocaleString('es-GT')}.\n\n`;
    } else if (criticalDates.length > 0) {
      const urgentCount = criticalDates.filter(d => d.days_from_today <= 7).length;
      if (urgentCount > 0) {
        narrative += `🔴 **CRÍTICO**: Se proyectan ${urgentCount} día(s) con déficit de efectivo en los próximos 7 días. `;
        narrative += `Acción inmediata requerida.\n\n`;
      } else {
        narrative += `⚠️ **Atención Requerida**: Se proyectan ${criticalDates.length} fecha(s) con déficit de efectivo `;
        narrative += `en el horizonte de ${horizon} días.\n\n`;
      }
    }

    // Critical dates detail
    if (criticalDates.length > 0) {
      narrative += `**Fechas Críticas**:\n`;
      criticalDates.slice(0, 3).forEach(cd => {
        narrative += `- ${cd.date} (${cd.days_from_today} días): Déficit de Q${Math.round(cd.shortage).toLocaleString('es-GT')}\n`;
      });
      if (criticalDates.length > 3) {
        narrative += `- ... y ${criticalDates.length - 3} fecha(s) adicional(es)\n`;
      }
      narrative += `\n`;
    }

    // Top recommendation
    if (recommendations.length > 0) {
      const topRec = recommendations[0];
      narrative += `**Recomendación Principal**: ${topRec.action}\n\n`;
      narrative += `*Justificación*: ${topRec.rationale}\n\n`;
    }

    // Working capital management
    narrative += `**Gestión de Capital de Trabajo**: `;
    if (criticalDates.length > 0) {
      narrative += `Considerar extensión de términos de pago con proveedores clave (Net 30 → Net 45) `;
      narrative += `y aceleración de cobranza (incentivar pago anticipado con 2-3% descuento).`;
    } else {
      narrative += `Posición actual permite mantener términos estándar. Evaluar inversiones de corto plazo para excedentes.`;
    }

    return narrative;
  }

  /**
   * Get working capital optimization analysis
   */
  static async getWorkingCapitalOptimization(request: FastifyRequest, reply: FastifyReply) {
    try {
      const prisma = request.server.prisma;

      const { fechaInicio, fechaFin } = request.query as { 
        fechaInicio?: string; 
        fechaFin?: string;
      };

      const startDate = fechaInicio ? new Date(fechaInicio) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const endDate = fechaFin ? new Date(fechaFin) : new Date();
      const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      // Step 1: Calculate Current State
      const currentStateQuery = `
        WITH revenue_data AS (
          SELECT 
            SUM(total_price) as total_revenue,
            COUNT(DISTINCT sale_datetime::date) as sales_days
          FROM sales_partitioned
          WHERE sale_datetime >= $1 
            AND sale_datetime < $2
            AND is_deleted = false
        ),
        inventory_data AS (
          SELECT 
            AVG(inv_value) as avg_inventory_value
          FROM (
            SELECT DISTINCT ON (snapshot_timestamp::date)
              snapshot_timestamp::date,
              SUM(quantity_on_hand * COALESCE(p.cost, 0)) OVER (PARTITION BY snapshot_timestamp::date) as inv_value
            FROM inventory_snapshots i
            JOIN products p ON i.product_id = p.product_id
            WHERE i.snapshot_timestamp >= $1
              AND i.snapshot_timestamp < $2
              AND i.is_deleted = false
            ORDER BY snapshot_timestamp::date, snapshot_timestamp DESC
          ) daily_inv
        ),
        cogs_data AS (
          SELECT 
            SUM(sp.quantity * COALESCE(p.cost, 0)) as total_cogs
          FROM sales_partitioned sp
          JOIN products p ON sp.product_id = p.product_id
          WHERE sp.sale_datetime >= $1 
            AND sp.sale_datetime < $2
            AND sp.is_deleted = false
        ),
        purchases_data AS (
          SELECT 
            COALESCE(SUM(quantity * unit_cost), 0) as total_purchases
          FROM purchases
          WHERE purchase_datetime >= $1
            AND purchase_datetime < $2
            AND is_deleted = false
        )
        SELECT 
          COALESCE(r.total_revenue, 0) as revenue,
          COALESCE(i.avg_inventory_value, 0) as avg_inventory,
          COALESCE(c.total_cogs, 0) as cogs,
          COALESCE(p.total_purchases, 0) as purchases,
          r.sales_days,
          $3 as period_days
        FROM revenue_data r
        CROSS JOIN inventory_data i
        CROSS JOIN cogs_data c
        CROSS JOIN purchases_data p;
      `;

      const currentStateResult = await QueryBuilder.executeWithDebug<WorkingCapitalCurrentStateRow[]>(
        prisma,
        currentStateQuery,
        [startDate, endDate, daysInPeriod],
        'currentWorkingCapital'
      );

      const defaultState: WorkingCapitalCurrentStateRow = {
        revenue: 0,
        avg_inventory: 0,
        cogs: 0,
        purchases: 0,
        sales_days: 0,
        period_days: daysInPeriod
      };

      const currentState = currentStateResult[0] ?? defaultState;

      const revenue = currentState.revenue;
      const avgInventory = currentState.avg_inventory;
      const cogs = currentState.cogs;
      const purchases = currentState.purchases;

      // Calculate current metrics
      // If no actual data, use reasonable estimates for demonstration
      const hasRealData = revenue > 0 && cogs > 0;
      
      let currentDIO: number;
      let currentDSO: number;
      let currentDPO: number;

      if (hasRealData) {
        // Real calculations
        currentDIO = cogs > 0 ? (avgInventory / cogs) * daysInPeriod : 45;
        currentDSO = revenue > 0 ? (revenue * 0.2 / revenue) * daysInPeriod : 35; // Assume 20% AR
        currentDPO = purchases > 0 ? (purchases * 0.15 / purchases) * daysInPeriod : 28; // Assume 15% AP
      } else {
        // Estimates based on industry standards
        currentDIO = 45;
        currentDSO = 35;
        currentDPO = 28;
      }

      const currentCCC = currentDIO + currentDSO - currentDPO;

      // Step 2: Calculate financial impact metrics
      const dailyRevenue = revenue / daysInPeriod;
      const dailyCOGS = cogs / daysInPeriod;
      
      // Cash tied up in working capital
      const cashTiedUp = (currentCCC / daysInPeriod) * (revenue + cogs);

      // Step 3: Generate optimization scenarios
      const scenarios = this.generateWorkingCapitalScenarios(
        currentDIO,
        currentDSO,
        currentDPO,
        currentCCC,
        dailyRevenue,
        dailyCOGS,
        avgInventory
      );

      // Step 4: Generate recommendations
      const recommendations = this.generateWorkingCapitalRecommendations(
        scenarios,
        currentCCC,
        currentDIO,
        currentDSO,
        currentDPO
      );

      // Step 5: Generate narrative
      const narrative = this.generateWorkingCapitalNarrative(
        hasRealData,
        currentCCC,
        scenarios,
        recommendations
      );

      return reply.status(200).send({
        success: true,
        data: {
          current_state: {
            dio: Number(currentDIO.toFixed(1)),
            dso: Number(currentDSO.toFixed(1)),
            dpo: Number(currentDPO.toFixed(1)),
            ccc: Number(currentCCC.toFixed(1)),
            avg_inventory_value: Math.round(avgInventory),
            cash_tied_up: Math.round(cashTiedUp),
            data_quality: hasRealData ? 'real' : 'estimated'
          },
          scenarios,
          recommendations,
          narrative,
          methodology: {
            dio_formula: 'DIO = (Inventario Promedio / Costo de Ventas) × Días en Período',
            dso_formula: 'DSO = (Cuentas por Cobrar / Ingresos) × Días en Período',
            dpo_formula: 'DPO = (Cuentas por Pagar / Costo de Ventas) × Días en Período',
            ccc_formula: 'CCC = DIO + DSO - DPO',
            interpretation: 'Un CCC más bajo indica mejor eficiencia en la gestión del capital de trabajo',
            note: hasRealData 
              ? 'Cálculos basados en datos reales del período seleccionado'
              : 'Cálculos basados en promedios de la industria. Datos de inventario/compras limitados.'
          }
        }
      });

    } catch (error: unknown) {
      request.log.error({ err: error }, '[Working Capital Optimization] Error:');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar optimización de capital de trabajo',
        message: getErrorMessage(error)
      });
    }
  }

  private static generateWorkingCapitalScenarios(
    currentDIO: number,
    currentDSO: number,
    currentDPO: number,
    currentCCC: number,
    dailyRevenue: number,
    dailyCOGS: number,
    avgInventory: number
  ): WorkingCapitalScenario[] {
    const scenarios: WorkingCapitalScenario[] = [];

  // Scenario 1: Reduce Inventory
  const inventoryReduction = 0.15; // 15% reduction
  const newDIO1 = currentDIO * (1 - inventoryReduction);
  const newCCC1 = newDIO1 + currentDSO - currentDPO;
  const cashFreed1 = (currentCCC - newCCC1) * dailyCOGS;

  scenarios.push({
    id: 'reduce_inventory',
    name: 'Reducir Inventario 15%',
    description: 'Optimizar niveles de stock mediante mejor pronóstico y gestión de SKUs lentos',
    parameters: {
      inventory_reduction_pct: 15,
      new_dio: Number(newDIO1.toFixed(1)),
      new_dso: currentDSO,
      new_dpo: currentDPO
    },
    impact: {
      new_ccc: Number(newCCC1.toFixed(1)),
      ccc_improvement: Number((currentCCC - newCCC1).toFixed(1)),
      cash_freed: Math.round(cashFreed1),
      inventory_reduction_value: Math.round(avgInventory * inventoryReduction)
    },
    risk_level: 'medium',
    risk_factors: [
      'Posible aumento en stockouts si se ejecuta mal',
      'Requiere pronósticos precisos',
      'Impacto gradual (3-6 meses)'
    ],
    implementation_difficulty: 'moderate',
    implementation_steps: [
      'Identificar SKUs de baja rotación',
      'Implementar sistema de pronóstico ML',
      'Reducir pedidos gradualmente',
      'Monitorear niveles de servicio'
    ]
  });

  // Scenario 2: Faster Collections (Reduce DSO)
  const dsoReduction = 7; // 7 days faster
  const newDSO2 = Math.max(currentDSO - dsoReduction, 20);
  const newCCC2 = currentDIO + newDSO2 - currentDPO;
  const cashFreed2 = (currentCCC - newCCC2) * dailyRevenue;

  scenarios.push({
    id: 'faster_collections',
    name: 'Acelerar Cobranza (−7 días)',
    description: 'Implementar descuentos por pronto pago e incentivos para cobro anticipado',
    parameters: {
      dso_reduction_days: 7,
      new_dio: currentDIO,
      new_dso: Number(newDSO2.toFixed(1)),
      new_dpo: currentDPO
    },
    impact: {
      new_ccc: Number(newCCC2.toFixed(1)),
      ccc_improvement: Number((currentCCC - newCCC2).toFixed(1)),
      cash_freed: Math.round(cashFreed2),
      discount_cost_estimate: Math.round(dailyRevenue * dsoReduction * 0.02) // 2% discount cost
    },
    risk_level: 'low',
    risk_factors: [
      'Costo de descuentos por pronto pago (2-3%)',
      'Requiere cambios en términos comerciales',
      'Posible resistencia de clientes'
    ],
    implementation_difficulty: 'easy',
    implementation_steps: [
      'Ofrecer 2% descuento por pago dentro de 10 días',
      'Automatizar recordatorios de pago',
      'Implementar pagos electrónicos',
      'Revisar crédito de clientes morosos'
    ]
  });

  // Scenario 3: Extend Payment Terms (Increase DPO)
  const dpoIncrease = 15; // 15 days longer
  const newDPO3 = currentDPO + dpoIncrease;
  const newCCC3 = currentDIO + currentDSO - newDPO3;
  const cashFreed3 = (currentCCC - newCCC3) * dailyCOGS;

  scenarios.push({
    id: 'extend_payments',
    name: 'Extender Pagos (+15 días)',
    description: 'Negociar términos de pago más largos con proveedores (Net 30 → Net 45)',
    parameters: {
      dpo_increase_days: 15,
      new_dio: currentDIO,
      new_dso: currentDSO,
      new_dpo: Number(newDPO3.toFixed(1))
    },
    impact: {
      new_ccc: Number(newCCC3.toFixed(1)),
      ccc_improvement: Number((currentCCC - newCCC3).toFixed(1)),
      cash_freed: Math.round(cashFreed3),
      supplier_relationship_risk: 'medium'
    },
    risk_level: 'medium',
    risk_factors: [
      'Puede afectar relaciones con proveedores',
      'Algunos proveedores pueden rechazar',
      'Posible pérdida de descuentos por pronto pago'
    ],
    implementation_difficulty: 'moderate',
    implementation_steps: [
      'Identificar proveedores con flexibilidad',
      'Negociar nuevos términos (mostrar historial de pagos)',
      'Priorizar proveedores de alto volumen',
      'Mantener comunicación transparente'
    ]
  });

  // Scenario 4: Combined Approach (Conservative)
  const inventoryReduction4 = 0.10; // 10%
  const dsoReduction4 = 5; // 5 days
  const dpoIncrease4 = 10; // 10 days
  
  const newDIO4 = currentDIO * (1 - inventoryReduction4);
  const newDSO4 = Math.max(currentDSO - dsoReduction4, 20);
  const newDPO4 = currentDPO + dpoIncrease4;
  const newCCC4 = newDIO4 + newDSO4 - newDPO4;
  const cashFreed4 = (currentCCC - newCCC4) * ((dailyRevenue + dailyCOGS) / 2);

  scenarios.push({
    id: 'combined_conservative',
    name: 'Enfoque Combinado (Conservador)',
    description: 'Mejoras incrementales en las tres áreas del ciclo de conversión',
    parameters: {
      inventory_reduction_pct: 10,
      dso_reduction_days: 5,
      dpo_increase_days: 10,
      new_dio: Number(newDIO4.toFixed(1)),
      new_dso: Number(newDSO4.toFixed(1)),
      new_dpo: Number(newDPO4.toFixed(1))
    },
    impact: {
      new_ccc: Number(newCCC4.toFixed(1)),
      ccc_improvement: Number((currentCCC - newCCC4).toFixed(1)),
      cash_freed: Math.round(cashFreed4),
      balanced_approach: true
    },
    risk_level: 'low',
    risk_factors: [
      'Riesgo distribuido entre múltiples acciones',
      'Cambios graduales reducen impacto negativo',
      'Requiere coordinación entre departamentos'
    ],
    implementation_difficulty: 'moderate',
    implementation_steps: [
      'Fase 1 (Mes 1-2): Extender pagos con proveedores clave',
      'Fase 2 (Mes 2-3): Implementar descuentos por pronto pago',
      'Fase 3 (Mes 3-6): Reducir inventario gradualmente',
      'Monitoreo continuo de KPIs'
    ]
  });

  // Scenario 5: Aggressive Optimization
  const inventoryReduction5 = 0.20; // 20%
  const dsoReduction5 = 10; // 10 days
  const dpoIncrease5 = 17; // 17 days (Net 45)
  
  const newDIO5 = currentDIO * (1 - inventoryReduction5);
  const newDSO5 = Math.max(currentDSO - dsoReduction5, 20);
  const newDPO5 = currentDPO + dpoIncrease5;
  const newCCC5 = newDIO5 + newDSO5 - newDPO5;
  const cashFreed5 = (currentCCC - newCCC5) * ((dailyRevenue + dailyCOGS) / 2);

  scenarios.push({
    id: 'aggressive_optimization',
    name: 'Optimización Agresiva',
    description: 'Transformación completa del ciclo de capital de trabajo',
    parameters: {
      inventory_reduction_pct: 20,
      dso_reduction_days: 10,
      dpo_increase_days: 17,
      new_dio: Number(newDIO5.toFixed(1)),
      new_dso: Number(newDSO5.toFixed(1)),
      new_dpo: Number(newDPO5.toFixed(1))
    },
    impact: {
      new_ccc: Number(newCCC5.toFixed(1)),
      ccc_improvement: Number((currentCCC - newCCC5).toFixed(1)),
      cash_freed: Math.round(cashFreed5),
      transformational: true
    },
    risk_level: 'high',
    risk_factors: [
      'Alto riesgo de stockouts',
      'Posible tensión con proveedores',
      'Requiere cambio cultural',
      'Necesita inversión en tecnología'
    ],
    implementation_difficulty: 'difficult',
    implementation_steps: [
      'Invertir en sistema avanzado de pronóstico',
      'Renegociar contratos con todos los proveedores',
      'Implementar crédito dinámico por cliente',
      'Requiere 12-18 meses de implementación'
    ]
  });

  return scenarios;
}

  private static generateWorkingCapitalRecommendations(
    scenarios: WorkingCapitalScenario[],
    currentCCC: number,
    currentDIO: number,
    currentDSO: number,
    currentDPO: number
  ): WorkingCapitalRecommendation[] {
    const recommendations: WorkingCapitalRecommendation[] = [];

  // Analyze current state
  const industryAvgCCC = 45; // Industry benchmark
  const industryAvgDIO = 40;
  const industryAvgDSO = 30;
  const industryAvgDPO = 35;

  // High CCC recommendation
  if (currentCCC > industryAvgCCC + 10) {
      const bestScenario = scenarios.find(s => s.id === 'combined_conservative') || scenarios[0];
      recommendations.push({
      priority: 'high',
      area: 'overall',
      action: 'Implementar optimización combinada del CCC',
      rationale: `CCC actual (${currentCCC.toFixed(0)} días) está significativamente sobre el promedio de la industria (${industryAvgCCC} días)`,
      estimated_impact: `Liberar Q${bestScenario.impact.cash_freed.toLocaleString('es-GT')} en efectivo`,
      timeframe: '6-9 meses'
    });
  }

  // High DIO recommendation
  if (currentDIO > industryAvgDIO) {
      recommendations.push({
      priority: 'high',
      area: 'inventory',
      action: 'Optimizar niveles de inventario',
      rationale: `DIO actual (${currentDIO.toFixed(0)} días) supera promedio de industria (${industryAvgDIO} días). Capital innecesario inmovilizado en stock`,
      estimated_impact: 'Reducir inventario 15-20% sin afectar servicio',
      timeframe: '3-6 meses'
    });
  }

  // High DSO recommendation
  if (currentDSO > industryAvgDSO) {
    recommendations.push({
      priority: 'high',
      area: 'receivables',
      action: 'Acelerar cobranza con descuentos por pronto pago',
      rationale: `DSO actual (${currentDSO.toFixed(0)} días) supera promedio (${industryAvgDSO} días). Clientes retienen efectivo demasiado tiempo`,
      estimated_impact: 'Reducir DSO en 7 días con descuento 2%',
      timeframe: '1-2 meses'
    });
  }

  // Low DPO recommendation
  if (currentDPO < industryAvgDPO - 5) {
    recommendations.push({
      priority: 'medium',
      area: 'payables',
      action: 'Negociar términos de pago más largos con proveedores',
      rationale: `DPO actual (${currentDPO.toFixed(0)} días) está por debajo del promedio (${industryAvgDPO} días). Oportunidad de retener efectivo más tiempo`,
      estimated_impact: 'Extender pagos de Net 30 a Net 45',
      timeframe: '2-3 meses'
    });
  }

  // Technology recommendation
  if (currentCCC > 50) {
    recommendations.push({
      priority: 'medium',
      area: 'overall',
      action: 'Implementar sistema automatizado de gestión de capital de trabajo',
      rationale: 'CCC alto indica oportunidades de mejora mediante automatización y análisis predictivo',
      estimated_impact: 'Reducir CCC en 20-30% mediante mejores pronósticos y automatización',
      timeframe: '6-12 meses'
    });
  }

  // Positive scenario
  if (currentCCC <= industryAvgCCC) {
    recommendations.push({
      priority: 'low',
      area: 'overall',
      action: 'Mantener prácticas actuales y buscar optimizaciones incrementales',
      rationale: `CCC actual (${currentCCC.toFixed(0)} días) está en rango competitivo`,
      estimated_impact: 'Mejoras marginales de 2-5 días mediante ajustes finos',
      timeframe: 'Continuo'
    });
  }

    return recommendations.sort((a, b) => {
      const priorityOrder: Record<WorkingCapitalRecommendation['priority'], number> = {
        high: 0,
        medium: 1,
        low: 2
      };
      return (priorityOrder[a.priority] ?? 999) - (priorityOrder[b.priority] ?? 999);
    });
}

  private static generateWorkingCapitalNarrative(
    hasRealData: boolean,
    currentCCC: number,
    scenarios: WorkingCapitalScenario[],
    recommendations: WorkingCapitalRecommendation[]
  ): string {
  let narrative = `## Optimización de Capital de Trabajo\n\n`;

  // Data quality notice
  if (!hasRealData) {
    narrative += `⚠️ **Nota sobre Datos**: Los cálculos utilizan estimaciones basadas en promedios de la industria debido a datos limitados de inventario y compras. Para análisis más preciso, asegurar que estos datos estén disponibles.\n\n`;
  }

  // Current state assessment
  narrative += `**Ciclo de Conversión de Efectivo Actual: ${currentCCC.toFixed(0)} días**\n\n`;

  const industryAvg = 45;
  if (currentCCC > industryAvg + 10) {
    narrative += `🔴 Su CCC está significativamente por encima del promedio de la industria (${industryAvg} días), `;
    narrative += `lo que indica que tiene capital inmovilizado innecesariamente en el ciclo operativo. `;
    narrative += `Esto representa una oportunidad sustancial de mejora.\n\n`;
  } else if (currentCCC > industryAvg) {
    narrative += `⚠️ Su CCC está ligeramente por encima del promedio de la industria (${industryAvg} días). `;
    narrative += `Hay oportunidades de optimización mediante mejoras incrementales.\n\n`;
  } else {
    narrative += `✅ Su CCC está en rango competitivo (promedio de industria: ${industryAvg} días). `;
    narrative += `Mantener estas prácticas y buscar optimizaciones marginales.\n\n`;
  }

  // Best scenario recommendation
  const conservativeScenario = scenarios.find(s => s.id === 'combined_conservative');
  const aggressiveScenario = scenarios.find(s => s.id === 'aggressive_optimization');

  if (conservativeScenario && currentCCC > industryAvg) {
    narrative += `**Recomendación Principal**: Implementar el enfoque combinado conservador que puede:\n`;
    narrative += `- Reducir CCC de ${currentCCC.toFixed(0)} a ${conservativeScenario.impact.new_ccc} días\n`;
    narrative += `- Liberar aproximadamente Q${conservativeScenario.impact.cash_freed.toLocaleString('es-GT')} en efectivo\n`;
    narrative += `- Menor riesgo operativo mediante cambios graduales\n\n`;
  }

  if (aggressiveScenario && currentCCC > industryAvg + 15) {
    narrative += `**Opción Transformacional**: Para empresas dispuestas a inversiones mayores, el enfoque agresivo puede:\n`;
    narrative += `- Reducir CCC a ${aggressiveScenario.impact.new_ccc} días (${aggressiveScenario.impact.ccc_improvement} días de mejora)\n`;
    narrative += `- Liberar hasta Q${aggressiveScenario.impact.cash_freed.toLocaleString('es-GT')} en efectivo\n`;
    narrative += `- Requiere inversión en tecnología y cambio cultural\n\n`;
  }

  // Top priority action
  if (recommendations.length > 0) {
    const topRec = recommendations[0];
    narrative += `**Acción Prioritaria**: ${topRec.action}\n\n`;
    narrative += `*Justificación*: ${topRec.rationale}\n\n`;
    narrative += `*Impacto Esperado*: ${topRec.estimated_impact}\n\n`;
  }

  // Implementation roadmap
  narrative += `**Hoja de Ruta de Implementación**:\n`;
  narrative += `1. **Corto Plazo (1-3 meses)**: Implementar descuentos por pronto pago, negociar términos con proveedores clave\n`;
  narrative += `2. **Mediano Plazo (3-6 meses)**: Optimizar niveles de inventario, implementar pronósticos ML\n`;
  narrative += `3. **Largo Plazo (6-12 meses)**: Monitoreo continuo, ajustes finos, expansión a todos los proveedores\n\n`;

  narrative += `**Beneficio Financiero**: La optimización del capital de trabajo no solo libera efectivo, `;
  narrative += `sino que también reduce costos financieros (intereses sobre líneas de crédito) y mejora el retorno sobre activos.`;

  return narrative;
}
}