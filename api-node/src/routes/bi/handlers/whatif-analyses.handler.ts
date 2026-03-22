import { FastifyRequest, FastifyReply } from 'fastify';
import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

type WhatIfScope = {
  time_horizon: string;
  product_category_id?: string[];
  product_id?: number[];
  supplier_id?: string[];
};

interface WhatIfRequest {
  variable_type: 'DEMAND_CHANGE' | 'LEAD_TIME_CHANGE' | 'COST_CHANGE' | 'PRICE_CHANGE';
  change_value: number;
  scope: WhatIfScope;
}

interface KPIImpact {
  kpi_name: string;
  base_value: string;
  projected_value: string;
  delta: string;
  impact_severity: 'positive' | 'negative' | 'neutral';
}

interface BaselineRow {
  total_revenue: string | number;
  order_count: string | number;
  avg_order_value: string | number;
  total_units_sold: string | number;
}

interface BaselineData {
  revenue: number;
  orders: number;
  units: number;
  avgOrderValue: number;
}

interface WhatIfResponse {
  scenario_name: string;
  variable_changed: string;
  change_description: string;
  projected_impacts: KPIImpact[];
  ai_narrative: string;
  constraints_violated: string[];
  recommendations: string[];
}

interface WhatIfImpactResult {
  projectedImpacts: KPIImpact[];
  constraintsViolated: string[];
  recommendations: string[];
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class WhatIfAnalysesHandler {
  static async run(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      const { variable_type, change_value, scope } = request.body as WhatIfRequest;

      // Validate input
      if (!variable_type || change_value === undefined) {
        return reply.status(400).send({
          error: 'Solicitud inválida',
          message: 'Se requieren variable_type y change_value'
        });
      }

      const app = request.server;

      const baselineData = await WhatIfAnalysesHandler.getBaselineData(app, scope);

      // Calculate projections based on variable type
      let projectedImpacts: KPIImpact[];
      let constraintsViolated: string[];
      let recommendations: string[];

      switch (variable_type) {
        case 'DEMAND_CHANGE':
          ({ projectedImpacts, constraintsViolated, recommendations } =
            WhatIfAnalysesHandler.calculateDemandImpact(
              baselineData,
              change_value
            ));
          break;
        case 'LEAD_TIME_CHANGE':
          ({ projectedImpacts, constraintsViolated, recommendations } =
            WhatIfAnalysesHandler.calculateLeadTimeImpact(
              baselineData,
              change_value
            ));
          break;
        case 'COST_CHANGE':
          ({ projectedImpacts, constraintsViolated, recommendations } =
            WhatIfAnalysesHandler.calculateCostImpact(
              baselineData,
              change_value
            ));
          break;
        case 'PRICE_CHANGE':
          ({ projectedImpacts, constraintsViolated, recommendations } =
            WhatIfAnalysesHandler.calculatePriceImpact(
              baselineData,
              change_value
            ));
          break;
        default: {
          const requestedType = variable_type as string;
          return reply.status(400).send({
            error: 'Tipo de variable no soportado',
            message: `El tipo ${requestedType} no está implementado`
          });
        }
      }

      // Generate scenario name
      const scenarioName = WhatIfAnalysesHandler.generateScenarioName(
        variable_type, 
        change_value, 
        scope
      );

      // Generate change description
      const changeDescription = WhatIfAnalysesHandler.generateChangeDescription(
        variable_type, 
        change_value, 
        scope
      );

      // Generate AI narrative
      const aiNarrative = WhatIfAnalysesHandler.generateNarrative(
        variable_type,
        change_value,
        projectedImpacts,
        constraintsViolated,
        recommendations
      );

      const response: WhatIfResponse = {
        scenario_name: scenarioName,
        variable_changed: variable_type,
        change_description: changeDescription,
        projected_impacts: projectedImpacts,
        ai_narrative: aiNarrative,
        constraints_violated: constraintsViolated,
        recommendations
      };

      return reply.status(200).send(response);
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Error running what-if analysis:');
      return reply.status(500).send({
        error: 'Error al ejecutar análisis simplificado',
        message: getErrorMessage(error)
      });
    }
  }

  private static async getBaselineData(prisma: AppWithPrisma, scope: WhatIfScope): Promise<BaselineData> {
    try {
      // Get recent sales data for baseline
      const salesQuery = `
        SELECT 
          COALESCE(SUM(total_price), 0) as total_revenue,
          COALESCE(COUNT(DISTINCT sale_id), 0) as order_count,
          COALESCE(AVG(total_price), 0) as avg_order_value,
          COALESCE(SUM(quantity * uom_ratio), 0) as total_units_sold
        FROM sales_partitioned s
        ${scope.product_id ? 'WHERE s.product_id = ANY($1::int[])' : ''}
        ${scope.product_id ? 'AND' : 'WHERE'} s.is_deleted = false
        AND s.sale_datetime >= NOW() - INTERVAL '90 days'
      `;
      
      const params = scope.product_id ? [scope.product_id] : [];
      const salesResult = await QueryBuilder.executeWithDebug<BaselineRow[]>(
        prisma.prisma,
        salesQuery,
        params,
        'WhatIfAnalysesHandler.getBaselineData'
      );

      const row = salesResult[0];
      const baseRevenue = Number(row?.total_revenue ?? 0);
      const baseOrders = Number(row?.order_count ?? 0);
      const baseUnits = Number(row?.total_units_sold ?? 0);

      return {
        revenue: baseRevenue,
        orders: baseOrders,
        units: baseUnits,
        avgOrderValue: baseOrders > 0 ? baseRevenue / baseOrders : 0
      };
    } catch (error: unknown) {
      prisma.log.error({ err: error }, 'Error getting baseline data:');
      return { revenue: 0, orders: 0, units: 0, avgOrderValue: 0 };
    }
  }

  private static calculateDemandImpact(
    baseline: BaselineData, 
    changePercent: number
  ): WhatIfImpactResult {
    const multiplier = 1 + changePercent;
    const projectedRevenue = baseline.revenue * multiplier;
    const projectedUnits = baseline.units * multiplier;
    
    const revenueDelta = projectedRevenue - baseline.revenue;
    const revenueDeltaPercentNum = baseline.revenue > 0 
      ? (revenueDelta / baseline.revenue) * 100
      : 0;
    const revenueDeltaPercent = revenueDeltaPercentNum.toFixed(1);

    const projectedImpacts: KPIImpact[] = [
      {
        kpi_name: 'Ingresos Proyectados',
        base_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue),
        projected_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedRevenue),
        delta: `${revenueDeltaPercentNum > 0 ? '+' : ''}${revenueDeltaPercent}%`,
        impact_severity: changePercent > 0 ? 'positive' : changePercent < 0 ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Unidades Vendidas',
        base_value: baseline.units.toLocaleString('es-GT'),
        projected_value: Math.round(projectedUnits).toLocaleString('es-GT'),
        delta: `${changePercent > 0 ? '+' : ''}${(changePercent * 100).toFixed(1)}%`,
        impact_severity: changePercent > 0 ? 'positive' : changePercent < 0 ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Tasa de Pedido Perfecto',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: '-',
        impact_severity: 'neutral'
      },
      {
        kpi_name: 'Inventario Requerido',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: '-',
        impact_severity: 'neutral'
      }
    ];

    const constraintsViolated: string[] = [];
    const recommendations: string[] = [];

    // Check for potential stockouts
    if (changePercent > 0.15) {
      constraintsViolated.push(
        'Incremento de demanda mayor al 15% puede causar desabasto sin inventario adicional'
      );
      recommendations.push(
        'Se recomienda aumentar inventario de seguridad en ' + Math.round(changePercent * 100) + '% anticipadamente'
      );
    }

    // Data limitation note
    constraintsViolated.push(
      'Análisis limitado: Se requieren datos de inventario y compras para proyección completa'
    );

    if (changePercent > 0) {
      recommendations.push(
        'Verificar capacidad de proveedores para soportar el aumento en demanda'
      );
    }

    return { projectedImpacts, constraintsViolated, recommendations };
  }

  private static calculateLeadTimeImpact(
    _baseline: BaselineData,
    additionalDays: number
  ): WhatIfImpactResult {
    const projectedImpacts: KPIImpact[] = [
      {
        kpi_name: 'Tasa de Pedido Perfecto',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: '-',
        impact_severity: 'neutral'
      },
      {
        kpi_name: 'Ciclo de Conversión de Efectivo',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: `+${additionalDays} días (estimado)`,
        impact_severity: additionalDays > 0 ? 'negative' : 'positive'
      },
      {
        kpi_name: 'Costo de Inventario',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: 'Incremento estimado',
        impact_severity: 'negative'
      }
    ];

    const constraintsViolated: string[] = [
      'Análisis limitado: Se requieren datos de órdenes de compra y entregas para cálculo preciso'
    ];

    const recommendations: string[] = [];

    if (additionalDays > 7) {
      constraintsViolated.push(
        `Incremento de ${additionalDays} días en tiempo de entrega aumenta significativamente riesgo de desabasto`
      );
      recommendations.push(
        'Considerar proveedores alternativos o aumentar punto de reorden'
      );
      recommendations.push(
        'Aumentar inventario de seguridad para cubrir el tiempo de entrega extendido'
      );
    }

    return { projectedImpacts, constraintsViolated, recommendations };
  }

  private static calculateCostImpact(
    baseline: BaselineData,
    changePercent: number
  ): WhatIfImpactResult {
    // Estimate margin impact
    const estimatedMarginImpact = changePercent * -1; // Cost increase = margin decrease

    const projectedImpacts: KPIImpact[] = [
      {
        kpi_name: 'Margen Bruto',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: `${estimatedMarginImpact > 0 ? '+' : ''}${(estimatedMarginImpact * 100).toFixed(1)}% (estimado)`,
        impact_severity: changePercent > 0 ? 'negative' : 'positive'
      },
      {
        kpi_name: 'Ingresos',
        base_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue),
        projected_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue),
        delta: 'Sin cambio (asume precio constante)',
        impact_severity: 'neutral'
      },
      {
        kpi_name: 'Rentabilidad',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: 'Disminuye con aumento de costos',
        impact_severity: changePercent > 0 ? 'negative' : 'positive'
      }
    ];

    const constraintsViolated: string[] = [
      'Análisis limitado: Se requieren datos de costos de producto para cálculo preciso'
    ];

    const recommendations: string[] = [];

    if (changePercent > 0.10) {
      constraintsViolated.push(
        `Incremento de ${(changePercent * 100).toFixed(0)}% en costos impacta significativamente la rentabilidad`
      );
      recommendations.push(
        'Considerar ajuste de precios para mantener margen objetivo'
      );
      recommendations.push(
        'Buscar proveedores alternativos o negociar mejores términos'
      );
    }

    return { projectedImpacts, constraintsViolated, recommendations };
  }

  private static calculatePriceImpact(
    baseline: BaselineData,
    changePercent: number
  ): WhatIfImpactResult {
    // Estimate demand elasticity (simplified: -1.2)
    const elasticity = -1.2;
    const demandChangePercent = changePercent * elasticity;
    const projectedUnits = baseline.units * (1 + demandChangePercent);
    const projectedRevenue = projectedUnits * baseline.avgOrderValue * (1 + changePercent);

    const revenueDelta = projectedRevenue - baseline.revenue;
    const revenueDeltaPercentNum = baseline.revenue > 0 
      ? (revenueDelta / baseline.revenue) * 100
      : 0;
    const revenueDeltaPercent = revenueDeltaPercentNum.toFixed(1);

    const projectedImpacts: KPIImpact[] = [
      {
        kpi_name: 'Ingresos Proyectados',
        base_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue),
        projected_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedRevenue),
        delta: `${revenueDeltaPercentNum > 0 ? '+' : ''}${revenueDeltaPercent}%`,
        impact_severity: revenueDelta > 0 ? 'positive' : revenueDelta < 0 ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Unidades Vendidas (proyectadas)',
        base_value: baseline.units.toLocaleString('es-GT'),
        projected_value: Math.round(projectedUnits).toLocaleString('es-GT'),
        delta: `${demandChangePercent > 0 ? '+' : ''}${(demandChangePercent * 100).toFixed(1)}%`,
        impact_severity: demandChangePercent > 0 ? 'positive' : 'negative'
      },
      {
        kpi_name: 'Margen Bruto',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: changePercent > 0 ? 'Mejora con precio mayor' : 'Disminuye con precio menor',
        impact_severity: changePercent > 0 ? 'positive' : 'negative'
      }
    ];

    const constraintsViolated: string[] = [
      'Proyección usa elasticidad estimada: Validar con datos históricos de sensibilidad a precio'
    ];

    const recommendations: string[] = [];

    if (changePercent > 0.15) {
      recommendations.push(
        `Aumento de precio del ${(changePercent * 100).toFixed(0)}% puede reducir demanda significativamente. Considerar implementación gradual.`
      );
    }

    if (changePercent < -0.10) {
      recommendations.push(
        `Reducción de precio del ${Math.abs(changePercent * 100).toFixed(0)}% puede no compensarse con aumento de volumen. Verificar impacto en rentabilidad.`
      );
    }

    return { projectedImpacts, constraintsViolated, recommendations };
  }

  private static generateScenarioName(
    variableType: WhatIfRequest['variable_type'],
    changeValue: number,
    scope: WhatIfScope
  ): string {
    const changePercent = (changeValue * 100).toFixed(0);
    const sign = changeValue > 0 ? '+' : '';

    switch (variableType) {
      case 'DEMAND_CHANGE':
        return `¿Qué pasaría si?: Demanda ${sign}${changePercent}% en ${scope.time_horizon}`;
      case 'LEAD_TIME_CHANGE':
        return `¿Qué pasaría si?: Tiempo de entrega ${sign}${changeValue} días`;
      case 'COST_CHANGE':
        return `¿Qué pasaría si?: Costos ${sign}${changePercent}%`;
      case 'PRICE_CHANGE':
        return `¿Qué pasaría si?: Precios ${sign}${changePercent}%`;
      default:
        return 'Análisis Simplificado';
    }
  }

  private static generateChangeDescription(
    variableType: WhatIfRequest['variable_type'],
    changeValue: number,
    scope: WhatIfScope
  ): string {
    const changePercent = (changeValue * 100).toFixed(1);
    const sign = changeValue > 0 ? 'incremento' : 'reducción';

    switch (variableType) {
      case 'DEMAND_CHANGE':
        return `Simula un ${sign} del ${Math.abs(parseFloat(changePercent))}% en la demanda durante ${scope.time_horizon}`;
      case 'LEAD_TIME_CHANGE':
        return `Simula un cambio de ${changeValue} días en el tiempo de entrega`;
      case 'COST_CHANGE':
        return `Simula un ${sign} del ${Math.abs(parseFloat(changePercent))}% en los costos`;
      case 'PRICE_CHANGE':
        return `Simula un ${sign} del ${Math.abs(parseFloat(changePercent))}% en los precios`;
      default:
        return 'Análisis de impacto';
    }
  }

  private static generateNarrative(
    variableType: WhatIfRequest['variable_type'],
    changeValue: number,
    impacts: KPIImpact[],
    constraints: string[],
    recommendations: string[]
  ): string {
    const parts: string[] = [];

    // Opening
    parts.push(`Este análisis simula el impacto de un cambio en ${variableType.toLowerCase().replace('_', ' ')}.\n\n`);

    // Key impacts
    parts.push('**Impactos Principales:**\n');
    impacts.forEach(impact => {
      if (impact.base_value !== 'No disponible' && impact.projected_value !== 'No disponible') {
        parts.push(`- ${impact.kpi_name}: ${impact.base_value} → ${impact.projected_value} (${impact.delta})\n`);
      }
    });

    // Constraints
    if (constraints.length > 0) {
      parts.push('\n**Consideraciones Importantes:**\n');
      constraints.forEach(c => parts.push(`- ${c}\n`));
    }

    // Recommendations
    if (recommendations.length > 0) {
      parts.push('\n**Recomendaciones:**\n');
      recommendations.forEach(r => parts.push(`- ${r}\n`));
    }

    return parts.join('');
  }
}
