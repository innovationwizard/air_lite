import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermissions } from '../../../middleware/auth';
import { ForecastService, AppWithPrisma } from './forecast.service';
import { ForecastDrilldownHandler } from '../handlers/forecast-drilldown.handler';
import { ForecastingQueries } from '../queries/forecasting.queries';

type ProductForecastQuery = {
  limit?: string;
  category?: string;
  days?: string;
};

type ProductParams = {
  productId: string;
};

const toSafeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function forecastRoutes(app: FastifyInstance) {
  const typedApp = app as AppWithPrisma;
  // Authentication is handled by parent route context in bi/index.ts
  // No need to add hook here as it would cause double authentication
  
  // GET /products
  app.get('/products', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { limit, category, days } = request.query as ProductForecastQuery;
    const limitValue = toSafeNumber(limit, 50);
    const forecastDays = toSafeNumber(days, 30);

    try {
      const forecasts = await ForecastService.getProductForecasts(typedApp, {
        limit: limitValue,
        category,
        forecastDays
      });

      return reply.send({
        success: true,
        data: forecasts
      });
    } catch (error) {
      const loggedError = error instanceof Error ? error : new Error('Forecast error');
      app.log.error(loggedError, 'Forecast error');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar pronósticos'
      });
    }
  });

  // GET /products/:productId
  app.get('/products/:productId', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { productId } = request.params as ProductParams;
    const { days } = request.query as ProductForecastQuery;
    const parsedProductId = Number(productId);

    if (!Number.isFinite(parsedProductId)) {
      return reply.status(400).send({
        success: false,
        error: 'ProductId inválido'
      });
    }

    const forecastDays = toSafeNumber(days, 30);

    try {
      const forecast = await ForecastService.getSingleProductForecast(
        typedApp,
        parsedProductId,
        forecastDays
      );

      return reply.send({
        success: true,
        data: forecast
      });
    } catch (error) {
      const loggedError = error instanceof Error ? error : new Error('Forecast error');
      app.log.error(loggedError, 'Forecast error');
      return reply.status(500).send({
        success: false,
        error: 'Error al generar pronóstico'
      });
    }
  });

  // GET /accuracy
  app.get('/accuracy', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return ForecastDrilldownHandler.getAccuracyBreakdown(request, reply);
  });

  // POST /scenario
  app.post('/scenario', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return ForecastDrilldownHandler.runScenario(request, reply);
  });

  // ── GET /decomposition ──────────────────────────────────────────────────────
  // Phase 3 – "Why" Decomposition (Checklist item).
  // Returns a time-series broken into three interpretable components:
  //   trend   = baseline / long-run growth (14-day centered MA)
  //   season  = weekly cyclical effect
  //   events  = residual (promotions, anomalies, external drivers)
  // Query params:
  //   historicalDays  (default 60)
  //   forecastDays    (default 30)
  type DecompositionQuery = { historicalDays?: string; forecastDays?: string };

  app.get('/decomposition', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { historicalDays, forecastDays } = request.query as DecompositionQuery;

    try {
      const result = await ForecastingQueries.getForecastDecomposition(
        typedApp,
        new Date(),
        toSafeNumber(historicalDays, 60),
        toSafeNumber(forecastDays, 30)
      );

      return reply.send({ success: true, data: result });
    } catch (error) {
      const loggedError = error instanceof Error ? error : new Error('Decomposition error');
      app.log.error(loggedError, 'Decomposition error');
      return reply.status(500).send({
        success: false,
        error: 'Error al calcular descomposición del pronóstico'
      });
    }
  });
}