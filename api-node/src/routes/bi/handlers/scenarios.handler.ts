import type { PrismaClient } from '@prisma/client';
import { FastifyRequest, FastifyReply } from 'fastify';
import { QueryBuilder } from '../utils/query-builder';

interface ScenarioParameter {
  variable_type: 'DEMAND_CHANGE' | 'LEAD_TIME_CHANGE' | 'COST_CHANGE' | 'PRICE_CHANGE';
  change_value: number;
  scope: {
    time_horizon: string;
    product_category_id?: string[];
    product_id?: number[];
    supplier_id?: string[];
  };
}

interface ScenarioRequest {
  scenario_id?: number; // For running existing scenario
  scenario_name?: string; // For creating new scenario
  description?: string;
  parameters?: ScenarioParameter[]; // Optional - predefined scenarios don't need this
  save_scenario?: boolean; // Whether to save for future use
}

interface KPIImpact {
  kpi_name: string;
  base_value: string;
  projected_value: string;
  delta: string;
  impact_severity: 'positive' | 'negative' | 'neutral';
}

interface ScenarioResponse {
  scenario_id?: number;
  scenario_name: string;
  description: string;
  execution_timestamp: string;
  projected_impacts: KPIImpact[];
  combined_effects: {
    revenue_impact: string;
    operational_impact: string;
    financial_impact: string;
  };
  ai_narrative: string;
  risk_assessment: {
    overall_risk: 'low' | 'medium' | 'high';
    key_risks: string[];
  };
  strategic_recommendations: string[];
}

interface ScenarioRow {
  scenario_name: string;
  description: string;
  parameters: string;
}

interface BaselineRow {
  total_revenue: string;
  order_count: string;
  avg_order_value: string;
  total_units_sold: string;
  total_cogs: string;
}

interface BaselineData {
  revenue: number;
  orders: number;
  units: number;
  cogs: number;
  avgOrderValue: number;
}

interface CombinedEffects {
  revenue_impact: string;
  operational_impact: string;
  financial_impact: string;
}

interface RiskAssessment {
  overall_risk: 'low' | 'medium' | 'high';
  key_risks: string[];
}

export class ScenariosHandler {
  // Predefined scenarios
  private static readonly PREDEFINED_SCENARIOS = {
    RECESSION: {
      name: 'Recesión Económica',
      description: 'Simula una recesión con caída en demanda, aumento en tiempos de entrega y costos',
      parameters: [
        {
          variable_type: 'DEMAND_CHANGE' as const,
          change_value: -0.15,
          scope: { time_horizon: 'FULL_YEAR', product_category_id: ['ALL'] }
        },
        {
          variable_type: 'LEAD_TIME_CHANGE' as const,
          change_value: 10,
          scope: { time_horizon: 'FULL_YEAR', supplier_id: ['ALL'] }
        },
        {
          variable_type: 'COST_CHANGE' as const,
          change_value: 0.10,
          scope: { time_horizon: 'FULL_YEAR', product_id: [] }
        }
      ]
    },
    SUPPLY_SHOCK: {
      name: 'Disrupción de Suministro',
      description: 'Simula disrupciones en cadena de suministro con retrasos y costos elevados',
      parameters: [
        {
          variable_type: 'LEAD_TIME_CHANGE' as const,
          change_value: 14,
          scope: { time_horizon: 'Q1', supplier_id: ['ALL'] }
        },
        {
          variable_type: 'COST_CHANGE' as const,
          change_value: 0.25,
          scope: { time_horizon: 'Q1', product_id: [] }
        }
      ]
    },
    DEMAND_BOOM: {
      name: 'Auge de Demanda',
      description: 'Simula crecimiento acelerado de demanda con presión competitiva',
      parameters: [
        {
          variable_type: 'DEMAND_CHANGE' as const,
          change_value: 0.30,
          scope: { time_horizon: 'Q2-Q3', product_category_id: ['ALL'] }
        },
        {
          variable_type: 'LEAD_TIME_CHANGE' as const,
          change_value: -5,
          scope: { time_horizon: 'Q2-Q3', supplier_id: ['ALL'] }
        }
      ]
    }
  };

  static async simulate(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      const { scenario_id, scenario_name, description, parameters, save_scenario } = request.body as ScenarioRequest;

      let scenarioConfig: ScenarioRequest;

      const prisma = request.server.prisma;

      // Load predefined or existing scenario
      if (scenario_id) {
        scenarioConfig = await ScenariosHandler.loadScenario(prisma, scenario_id);
      } else if (scenario_name && ScenariosHandler.isPredefinedScenario(scenario_name)) {
        scenarioConfig = ScenariosHandler.getPredefinedScenario(scenario_name);
      } else {
        // Use custom parameters from request
        if (!parameters || parameters.length === 0) {
          return reply.status(400).send({
            error: 'Parámetros inválidos',
            message: 'Se requieren parámetros de escenario o scenario_id'
          });
        }
        scenarioConfig = { scenario_name: scenario_name || 'Escenario Personalizado', description: description || '', parameters: parameters || [] };
      }

      // Get baseline data
      const baseline = await ScenariosHandler.getBaselineData(prisma);

      // Apply all parameter changes cumulatively
      const { projectedImpacts, combinedEffects } = ScenariosHandler.simulateScenario(
        baseline,
        scenarioConfig.parameters || []
      );

      // Risk assessment
      const riskAssessment = ScenariosHandler.assessRisk(projectedImpacts, scenarioConfig.parameters || []);

      // Generate strategic recommendations
      const strategicRecommendations = ScenariosHandler.generateRecommendations(
        projectedImpacts,
        riskAssessment,
        scenarioConfig.parameters || []
      );

      // Generate narrative
      const aiNarrative = ScenariosHandler.generateNarrative(
        scenarioConfig.scenario_name || 'Escenario',
        projectedImpacts,
        combinedEffects,
        riskAssessment,
        strategicRecommendations
      );

      // Save scenario if requested
      let savedScenarioId: number | undefined;
      if (save_scenario && !scenario_id) {
        savedScenarioId = await ScenariosHandler.saveScenario(
          prisma,
          scenarioConfig,
          projectedImpacts,
          combinedEffects,
          request.user?.id
        );
      }

      const response: ScenarioResponse = {
        scenario_id: savedScenarioId || scenario_id,
        scenario_name: scenarioConfig.scenario_name || 'Escenario Personalizado',
        description: scenarioConfig.description || '',
        execution_timestamp: new Date().toISOString(),
        projected_impacts: projectedImpacts,
        combined_effects: combinedEffects,
        ai_narrative: aiNarrative,
        risk_assessment: riskAssessment,
        strategic_recommendations: strategicRecommendations
      };

      return reply.status(200).send(response);
    } catch (error) {
      console.error('Error simulating scenario:', error);
      return reply.status(500).send({
        error: 'Error al simular escenario',
        message: error instanceof Error ? error.message : 'Error desconocido'
      });
    }
  }

  static async listPredefinedScenarios(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const scenarios = Object.entries(ScenariosHandler.PREDEFINED_SCENARIOS).map(([key, config]) => ({
      id: key,
      name: config.name,
      description: config.description,
      parameter_count: config.parameters.length
    }));

    return reply.status(200).send({ scenarios });
  }

  private static isPredefinedScenario(name: string): boolean {
    return Object.keys(ScenariosHandler.PREDEFINED_SCENARIOS).includes(name.toUpperCase().replace(/\s+/g, '_'));
  }

  private static getPredefinedScenario(name: string): ScenarioRequest {
    const key = name.toUpperCase().replace(/\s+/g, '_') as keyof typeof ScenariosHandler.PREDEFINED_SCENARIOS;
    const config = ScenariosHandler.PREDEFINED_SCENARIOS[key];
    return {
      scenario_name: config.name,
      description: config.description,
      parameters: config.parameters
    };
  }

  private static async loadScenario(prisma: PrismaClient, scenarioId: number): Promise<ScenarioRequest> {
    const result = await QueryBuilder.executeWithDebug<ScenarioRow[]>(
      prisma,
      `
      SELECT scenario_name, description, parameters
      FROM forecast_scenarios
      WHERE scenario_id = $1 AND is_active = true
    `,
      [scenarioId],
      'ScenariosHandler.loadScenario'
    );

    const rows = Array.isArray(result) ? result : [result];
    if (rows.length === 0 || !rows[0]) {
      throw new Error(`Escenario ${scenarioId} no encontrado`);
    }

    const row = rows[0];
    return {
      scenario_id: scenarioId,
      scenario_name: row.scenario_name,
      description: row.description,
      parameters: row.parameters ? JSON.parse(row.parameters) as ScenarioParameter[] : []
    };
  }

  private static async getBaselineData(prisma: PrismaClient): Promise<BaselineData> {
    try {
      const salesQuery = `
        SELECT 
          COALESCE(SUM(total_price), 0) as total_revenue,
          COALESCE(COUNT(DISTINCT sale_id), 0) as order_count,
          COALESCE(AVG(total_price), 0) as avg_order_value,
          COALESCE(SUM(quantity * uom_ratio), 0) as total_units_sold,
          COALESCE(SUM(quantity * p.cost), 0) as total_cogs
        FROM sales_partitioned s
        LEFT JOIN products p ON s.product_id = p.product_id
        WHERE s.is_deleted = false
          AND s.sale_datetime >= NOW() - INTERVAL '90 days'
      `;

      const result = await QueryBuilder.executeWithDebug<BaselineRow[]>(
        prisma,
        salesQuery,
        [],
        'ScenariosHandler.getBaselineData'
      );
      
      const row = Array.isArray(result) ? result[0] : result;

      return {
        revenue: parseFloat(row?.total_revenue || '0'),
        orders: parseInt(row?.order_count || '0'),
        units: parseInt(row?.total_units_sold || '0'),
        cogs: parseFloat(row?.total_cogs || '0'),
        avgOrderValue: parseFloat(row?.avg_order_value || '0')
      };
    } catch (error) {
      console.error('Error getting baseline data:', error);
      return { revenue: 0, orders: 0, units: 0, cogs: 0, avgOrderValue: 0 };
    }
  }

  private static simulateScenario(
    baseline: BaselineData,
    parameters: ScenarioParameter[]
  ): { projectedImpacts: KPIImpact[]; combinedEffects: CombinedEffects } {
    // Start with baseline
    const currentUnits = baseline.units;
    const currentCogs = baseline.cogs;
    const currentMargin = baseline.revenue - baseline.cogs;

    // Track cumulative effects
    let demandMultiplier = 1.0;
    let costMultiplier = 1.0;
    let priceMultiplier = 1.0;
    let leadTimeChange = 0;

    // Apply each parameter
    for (const param of parameters) {
      switch (param.variable_type) {
        case 'DEMAND_CHANGE':
          demandMultiplier *= (1 + param.change_value);
          break;
        case 'COST_CHANGE':
          costMultiplier *= (1 + param.change_value);
          break;
        case 'PRICE_CHANGE':
          priceMultiplier *= (1 + param.change_value);
          // Price changes affect demand (elasticity)
          demandMultiplier *= (1 + param.change_value * -1.2);
          break;
        case 'LEAD_TIME_CHANGE':
          leadTimeChange += param.change_value;
          break;
      }
    }

    // Calculate final projected values
    const projectedUnits = currentUnits * demandMultiplier;
    const projectedCogs = currentCogs * demandMultiplier * costMultiplier;
    const projectedRevenue = projectedUnits * baseline.avgOrderValue * priceMultiplier;
    const projectedMargin = projectedRevenue - projectedCogs;

    // Build impact summary
    const projectedImpacts: KPIImpact[] = [
      {
        kpi_name: 'Ingresos Totales',
        base_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue),
        projected_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedRevenue),
        delta: `${((projectedRevenue - baseline.revenue) / baseline.revenue * 100).toFixed(1)}%`,
        impact_severity: projectedRevenue > baseline.revenue ? 'positive' : projectedRevenue < baseline.revenue ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Unidades Vendidas',
        base_value: baseline.units.toLocaleString('es-GT'),
        projected_value: Math.round(projectedUnits).toLocaleString('es-GT'),
        delta: `${((demandMultiplier - 1) * 100).toFixed(1)}%`,
        impact_severity: demandMultiplier > 1 ? 'positive' : demandMultiplier < 1 ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Margen Bruto',
        base_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(currentMargin),
        projected_value: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedMargin),
        delta: `${((projectedMargin - currentMargin) / Math.abs(currentMargin || 1) * 100).toFixed(1)}%`,
        impact_severity: projectedMargin > currentMargin ? 'positive' : projectedMargin < currentMargin ? 'negative' : 'neutral'
      },
      {
        kpi_name: 'Tasa de Pedido Perfecto',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: leadTimeChange > 0 ? 'Disminuye (estimado)' : leadTimeChange < 0 ? 'Mejora (estimado)' : '-',
        impact_severity: leadTimeChange > 0 ? 'negative' : leadTimeChange < 0 ? 'positive' : 'neutral'
      },
      {
        kpi_name: 'Ciclo de Conversión de Efectivo',
        base_value: 'No disponible',
        projected_value: 'No disponible',
        delta: leadTimeChange !== 0 ? `${leadTimeChange > 0 ? '+' : ''}${leadTimeChange} días (estimado)` : '-',
        impact_severity: leadTimeChange > 0 ? 'negative' : leadTimeChange < 0 ? 'positive' : 'neutral'
      }
    ];

    const combinedEffects: CombinedEffects = {
      revenue_impact: projectedRevenue > baseline.revenue 
        ? `Incremento de ${new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedRevenue - baseline.revenue)}`
        : `Reducción de ${new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(baseline.revenue - projectedRevenue)}`,
      operational_impact: leadTimeChange !== 0 
        ? `Tiempo de entrega ${leadTimeChange > 0 ? 'aumenta' : 'disminuye'} ${Math.abs(leadTimeChange)} días`
        : 'Sin cambios significativos',
      financial_impact: projectedMargin > currentMargin
        ? `Margen mejora en ${new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(projectedMargin - currentMargin)}`
        : `Margen disminuye en ${new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(currentMargin - projectedMargin)}`
    };

    return { projectedImpacts, combinedEffects };
  }

  private static assessRisk(impacts: KPIImpact[], parameters: ScenarioParameter[]): RiskAssessment {
    let riskScore = 0;
    const keyRisks: string[] = [];

    // Assess revenue risk
    const revenueImpact = impacts.find(i => i.kpi_name === 'Ingresos Totales');
    if (revenueImpact?.impact_severity === 'negative') {
      const deltaNum = parseFloat(revenueImpact.delta);
      if (deltaNum < -15) {
        riskScore += 3;
        keyRisks.push('Caída significativa de ingresos (>15%)');
      } else if (deltaNum < -5) {
        riskScore += 2;
        keyRisks.push('Reducción moderada de ingresos');
      }
    }

    // Assess margin risk
    const marginImpact = impacts.find(i => i.kpi_name === 'Margen Bruto');
    if (marginImpact?.impact_severity === 'negative') {
      riskScore += 2;
      keyRisks.push('Compresión de margen bruto');
    }

    // Assess operational risk from lead time
    const hasLeadTimeIncrease = parameters.some(p => 
      p.variable_type === 'LEAD_TIME_CHANGE' && p.change_value > 7
    );
    if (hasLeadTimeIncrease) {
      riskScore += 2;
      keyRisks.push('Tiempos de entrega extendidos aumentan riesgo de desabasto');
    }

    // Data limitation risk
    keyRisks.push('Simulación limitada por datos faltantes de compras e inventario');

    const overallRisk: 'low' | 'medium' | 'high' = 
      riskScore >= 5 ? 'high' : riskScore >= 3 ? 'medium' : 'low';

    return { overall_risk: overallRisk, key_risks: keyRisks };
  }

  private static generateRecommendations(
    impacts: KPIImpact[],
    risk: RiskAssessment,
    parameters: ScenarioParameter[]
  ): string[] {
    const recommendations: string[] = [];

    // Revenue recommendations
    const revenueImpact = impacts.find(i => i.kpi_name === 'Ingresos Totales');
    if (revenueImpact?.impact_severity === 'negative') {
      recommendations.push('Desarrollar estrategias de retención de clientes y expansión de mercado');
      recommendations.push('Considerar ajustes en mix de productos hacia categorías de mayor margen');
    }

    // Margin recommendations
    const marginImpact = impacts.find(i => i.kpi_name === 'Margen Bruto');
    if (marginImpact?.impact_severity === 'negative') {
      recommendations.push('Negociar mejores términos con proveedores o buscar alternativas');
      recommendations.push('Evaluar ajustes de precios selectivos en productos de baja elasticidad');
    }

    // Lead time recommendations
    const hasLeadTimeRisk = parameters.some(p => 
      p.variable_type === 'LEAD_TIME_CHANGE' && p.change_value > 5
    );
    if (hasLeadTimeRisk) {
      recommendations.push('Aumentar inventario de seguridad para productos críticos');
      recommendations.push('Diversificar base de proveedores para reducir dependencia');
    }

    // Demand recommendations
    const hasDemandIncrease = parameters.some(p => 
      p.variable_type === 'DEMAND_CHANGE' && p.change_value > 0.15
    );
    if (hasDemandIncrease) {
      recommendations.push('Asegurar capacidad de proveedores antes de comprometerse con clientes');
      recommendations.push('Implementar sistema de alertas tempranas para prevenir desabastos');
    }

    // General risk mitigation
    if (risk.overall_risk === 'high') {
      recommendations.push('Desarrollar plan de contingencia detallado para este escenario');
      recommendations.push('Establecer revisiones mensuales de indicadores para detección temprana');
    }

    return recommendations;
  }

  private static generateNarrative(
    scenarioName: string,
    impacts: KPIImpact[],
    effects: CombinedEffects,
    risk: RiskAssessment,
    recommendations: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`## Simulación: ${scenarioName}\n\n`);
    
    parts.push('### Resumen Ejecutivo\n\n');
    parts.push(`Este escenario presenta un riesgo **${risk.overall_risk === 'high' ? 'ALTO' : risk.overall_risk === 'medium' ? 'MEDIO' : 'BAJO'}** para el negocio.\n\n`);

    parts.push('### Impactos Proyectados\n\n');
    parts.push(`**Ingresos:** ${effects.revenue_impact}\n\n`);
    parts.push(`**Operaciones:** ${effects.operational_impact}\n\n`);
    parts.push(`**Finanzas:** ${effects.financial_impact}\n\n`);

    if (risk.key_risks.length > 0) {
      parts.push('### Riesgos Clave\n\n');
      risk.key_risks.forEach((r: string) => parts.push(`- ${r}\n`));
      parts.push('\n');
    }

    if (recommendations.length > 0) {
      parts.push('### Recomendaciones Estratégicas\n\n');
      recommendations.forEach(r => parts.push(`- ${r}\n`));
    }

    parts.push('\n---\n\n');
    parts.push('*Nota: Esta simulación se basa en datos históricos de ventas. Para análisis más preciso, se requieren datos de compras, inventario y entregas.*');

    return parts.join('');
  }

  private static async saveScenario(
    prisma: PrismaClient,
    config: ScenarioRequest,
    impacts: KPIImpact[],
    effects: CombinedEffects,
    userId?: number
  ): Promise<number> {
    try {
    const result = await QueryBuilder.executeWithDebug<{ scenario_id: number }[]>(
        prisma,
        `
        INSERT INTO forecast_scenarios 
        (scenario_name, description, parameters, base_date, adjusted_forecast, impact_summary, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING scenario_id
      `,
        [
          config.scenario_name,
          config.description,
          JSON.stringify(config.parameters || []),
          new Date().toISOString(),
          JSON.stringify(impacts),
          JSON.stringify(effects),
          userId || null
        ],
        'ScenariosHandler.saveScenario'
      );

      const row = Array.isArray(result) ? result[0] : result;
      return row?.scenario_id;
    } catch (error) {
      console.error('Error saving scenario:', error);
      throw new Error('No se pudo guardar el escenario');
    }
  }
}
