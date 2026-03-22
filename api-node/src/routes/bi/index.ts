import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate, requirePermissions } from '../../middleware/auth';
import { DashboardHandler } from './handlers/dashboard.handler';
import { DrillDownHandler } from './handlers/drilldown.handler';
import { DeepDiveHandler } from './handlers/deepdive.handler';
import { AIExplanationHandler } from './handlers/ai-explanation.handler';
import { FeedbackHandler } from './handlers/feedback.handler';
import { ExportHandler } from './export/export.handler';
import { CacheService } from './services/cache.service';
import { forecastRoutes } from './forecasts/index';
import { customerRoutes } from './customers/index';
import { ComprasHandler } from './handlers/compras.handler';
import { StrategicReportsHandler } from './handlers/strategic-reports.handler';
import { WhatIfAnalysesHandler } from './handlers/whatif-analyses.handler';
import { ScenariosHandler } from './handlers/scenarios.handler';
import { FinanzasHandler } from './handlers/finanzas.handler';
import { InventarioHandler } from './handlers/inventario.handler';
import { VentasHandler } from './handlers/ventas.handler';

export const biRoutes: FastifyPluginAsync = async (app) => {
  app.log.info('[BI ROUTES] Initializing BI routes');

  // Initialize services
  CacheService.initialize();

  // Apply authentication to ALL BI routes using hooks
  await app.register(async (protectedRoutes: FastifyInstance) => {
    // Apply authentication hook to all routes in this context
    protectedRoutes.addHook('onRequest', authenticate);

    // GET /v1/bi/dashboards - Level 0: At-a-Glance with chart-ready data
    protectedRoutes.get('/dashboards', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => DashboardHandler.getDashboards(request, reply));

    // GET /v1/bi/dashboards/:dashboardType - Specific dashboard type
    protectedRoutes.get('/dashboards/:dashboardType', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => DashboardHandler.getSpecificDashboard(request, reply));

    // GET /v1/bi/drill-down/:metric - Level 1: Detailed analysis
    protectedRoutes.get('/drill-down/:metric', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => DrillDownHandler.getDrillDown(request, reply));

    // GET /v1/bi/deep-dive/:entity - Level 2: Raw exportable data
    protectedRoutes.get('/deep-dive/:entity', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => DeepDiveHandler.getDeepDive(request, reply));

    // GET /v1/bi/ai-explanation/:id - Trust through transparency
    protectedRoutes.get('/ai-explanation/:id', {
      preHandler: [requirePermissions('recommendation:read')],
    }, (request, reply) => AIExplanationHandler.getAIExplanation(request, reply));

    // POST /v1/bi/feedback - Human-in-the-loop feedback
    protectedRoutes.post('/feedback', (request, reply) => FeedbackHandler.submitFeedback(request, reply));

    // POST /v1/bi/export - Generate reports (PDF/Excel/CSV)
    protectedRoutes.post('/export', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => ExportHandler.handleExport(request, reply));

    // Register forecast routes under /v1/bi/forecasts
    await protectedRoutes.register(forecastRoutes, { prefix: '/forecasts' });

    // Register customer routes under /v1/bi/customers
    await protectedRoutes.register(customerRoutes, { prefix: '/customers' });

    // ========================================
    // Gerencia Strategic Handlers
    // ========================================

    // POST /api/v1/bi/gerencia/strategic-reports
    protectedRoutes.post('/gerencia/strategic-reports', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => StrategicReportsHandler.generate(request, reply));

    // POST /api/v1/bi/gerencia/what-if-analyses
    protectedRoutes.post('/gerencia/what-if-analyses', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => WhatIfAnalysesHandler.run(request, reply));

    // POST /api/v1/bi/gerencia/scenarios
    protectedRoutes.post('/gerencia/scenarios', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => ScenariosHandler.simulate(request, reply));

    // GET /api/v1/bi/gerencia/scenarios/predefined
    protectedRoutes.get('/gerencia/scenarios/predefined', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => ScenariosHandler.listPredefinedScenarios(request, reply));

    // ========================================
    // Compras Analytical Handlers
    // ========================================

    // GET /api/v1/bi/compras/supplier-scorecard - Month-by-month supplier trends
    protectedRoutes.get('/compras/supplier-scorecard', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => ComprasHandler.getSupplierScorecard(request, reply));

    // GET /api/v1/bi/compras/at-risk-shipments - AI predictions of delays
    protectedRoutes.get('/compras/at-risk-shipments', {
      preHandler: [requirePermissions('dashboard:read')],
    }, (request, reply) => ComprasHandler.getAtRiskShipments(request, reply));

    // Finanzas routes
    protectedRoutes.post('/finanzas/monthly-report', {
      schema: {
        description: 'Generate comprehensive monthly financial report',
        tags: ['finanzas'],
        body: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' }
          }
        }
      }
    }, (request, reply) => FinanzasHandler.generateMonthlyReport(request, reply));

    protectedRoutes.get('/finanzas/budget-analysis', {
      schema: {
        description: 'Analyze budget vs actual spending',
        tags: ['finanzas'],
        querystring: {
          type: 'object',
          properties: {
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            categories: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    }, (request, reply) => FinanzasHandler.analyzeBudget(request, reply));

    protectedRoutes.get('/finanzas/gmroi-matrix', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Generate GMROI Matrix - Strategic inventory return analysis',
        tags: ['finanzas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' }
          }
        }
      }
    }, (request, reply) => FinanzasHandler.getGMROIMatrix(request, reply));

    protectedRoutes.get('/finanzas/cash-flow-forecast', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Generate cash flow forecast with ML predictions',
        tags: ['finanzas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            horizonDays: { type: 'string' },
            startingCash: { type: 'string' }
          }
        }
      }
    }, (request, reply) => FinanzasHandler.getCashFlowForecast(request, reply));

    protectedRoutes.get('/finanzas/working-capital-optimization', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Generate working capital optimization analysis',
        tags: ['finanzas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' }
          }
        }
      }
    }, (request, reply) => FinanzasHandler.getWorkingCapitalOptimization(request, reply));

    // ========================================
    // Inventario AI Discrepancy Analysis
    // ========================================

    // GET /api/v1/bi/inventario/ai-discrepancies - AI-powered anomaly detection
    protectedRoutes.get('/inventario/ai-discrepancies', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Detectar discrepancias de inventario usando análisis de IA',
        tags: ['inventario'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            minConfidence: { type: 'number', minimum: 0, maximum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        }
      }
    }, (request, reply) => InventarioHandler.getAIDiscrepancies(request, reply));

    // GET /api/v1/bi/inventario/reorder-recommendations - Smart reorder recommendations
    protectedRoutes.get('/inventario/reorder-recommendations', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Generar recomendaciones de reabastecimiento inteligente usando ML',
        tags: ['inventario'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            minConfidence: { type: 'number', minimum: 0, maximum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        }
      }
    }, (request, reply) => InventarioHandler.getReorderRecommendations(request, reply));

    // GET /api/v1/bi/inventario/stock-optimization - Stock optimization analysis
    protectedRoutes.get('/inventario/stock-optimization', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Analizar optimización de stock: slow movers, inventario antiguo, overstock',
        tags: ['inventario'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            minValue: { type: 'number', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 200 }
          }
        }
      }
    }, (request, reply) => InventarioHandler.getStockOptimization(request, reply));

    // ========================================
    // Ventas AI Features
    // ========================================

    // GET /api/v1/bi/ventas/product-forecasts - Product demand forecasts (30 days)
    protectedRoutes.get('/ventas/product-forecasts', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Obtener pronósticos de demanda por producto con ML',
        tags: ['ventas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        }
      }
    }, (request, reply) => VentasHandler.getProductForecasts(request, reply));

    // GET /api/v1/bi/ventas/rfm-analysis - RFM customer segmentation
    protectedRoutes.get('/ventas/rfm-analysis', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Análisis RFM de segmentación de clientes',
        tags: ['ventas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            lookbackDays: { type: 'integer', minimum: 30, maximum: 730 }
          }
        }
      }
    }, (request, reply) => VentasHandler.getRFMAnalysis(request, reply));

    // GET /api/v1/bi/ventas/cross-sell - Cross-sell opportunities
    protectedRoutes.get('/ventas/cross-sell', {
      preHandler: [requirePermissions('dashboard:read')],
      schema: {
        description: 'Oportunidades de venta cruzada usando análisis de afinidad de productos',
        tags: ['ventas'],
        querystring: {
          type: 'object',
          properties: {
            fechaInicio: { type: 'string', format: 'date' },
            fechaFin: { type: 'string', format: 'date' },
            minSupport: { type: 'integer', minimum: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100 }
          }
        }
      }
    }, (request, reply) => VentasHandler.getCrossSellOpportunities(request, reply));
  });

  app.log.info('[BI ROUTES] BI routes initialized successfully');
};
