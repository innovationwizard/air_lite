import { FastifyRequest, FastifyReply } from 'fastify';
import { ForecastingQueries } from '../queries/forecasting.queries';

interface ForecastDrilldownQuery {
  startDate?: string;
  endDate?: string;
  limit?: string;
}

interface ScenarioSimulationBody {
  demandChangePercent?: number;
  promotionImpact?: number;
  leadTimeChange?: number;
  horizon?: number;
  saveName?: string;
  saveDescription?: string;
}

type ForecastRequest<TQuery = Record<string, unknown>> = FastifyRequest<{
  Querystring: TQuery;
}> & { user?: { id: number; user_id?: number } };

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class ForecastDrilldownHandler {
  /**
   * GET /v1/bi/forecast/products
   * Get product-level forecasts with ML explainability
   */
  static async getProductForecasts(req: ForecastRequest<ForecastDrilldownQuery>, reply: FastifyReply) {
    try {
      const { startDate, endDate, limit } = req.query;
      
      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? new Date(endDate) : undefined;
      const resultLimit = limit ? parseInt(limit) : 20;

      req.log.info({ startDate, endDate, limit: resultLimit }, '[FORECAST DRILLDOWN] Getting product forecasts');

      const app = req.server;
      const forecasts = await ForecastingQueries.getProductForecasts(app, start, end, resultLimit);

      reply.send({
        success: true,
        data: {
          forecasts,
          meta: {
            count: forecasts.length,
            period: startDate && endDate ? { start: startDate, end: endDate } : 'last_90_days'
          }
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[FORECAST DRILLDOWN] Error getting product forecasts:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener pronósticos de productos',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/forecast/accuracy
   * Get forecast accuracy breakdown by product and category
   */
  static async getAccuracyBreakdown(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[FORECAST DRILLDOWN] Getting accuracy breakdown');

      const app = req.server;
      const breakdown = await ForecastingQueries.getForecastAccuracyBreakdown(app);

      reply.send({
        success: true,
        data: breakdown
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[FORECAST DRILLDOWN] Error getting accuracy breakdown:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener desglose de precisión',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * POST /v1/bi/forecast/scenario
   * Run scenario simulation ("What if" analysis)
   */
  static async runScenario(req: FastifyRequest, reply: FastifyReply) {
    try {
      const body = req.body as ScenarioSimulationBody;
      const user = req.user;

      req.log.info({ body }, '[FORECAST DRILLDOWN] Running scenario simulation');

      const app = req.server;
      const result = await ForecastingQueries.runScenarioSimulation(app, {
        demandChangePercent: body.demandChangePercent,
        promotionImpact: body.promotionImpact,
        leadTimeChange: body.leadTimeChange,
        horizon: body.horizon
      });

      // If user wants to save the scenario
      if (body.saveName && user?.id) {
        const scenarioId = await ForecastingQueries.saveScenario(
          app,
          user.id,
          body.saveName,
          body.saveDescription || '',
          {
            demandChangePercent: body.demandChangePercent,
            promotionImpact: body.promotionImpact,
            leadTimeChange: body.leadTimeChange,
            horizon: body.horizon
          },
          result
        );

        req.log.info({ scenarioId }, '[FORECAST DRILLDOWN] Scenario saved with ID:');
        
        reply.send({
          success: true,
          data: {
            ...result,
            saved_scenario_id: scenarioId
          }
        });
      } else {
        reply.send({
          success: true,
          data: result
        });
      }

    } catch (error: unknown) {
      req.log.error({ err: error }, '[FORECAST DRILLDOWN] Error running scenario:');
      reply.status(500).send({
        success: false,
        error: 'Error al ejecutar simulación de escenario',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/forecast/scenarios
   * Get saved scenarios for the current user
   */
  static async getSavedScenarios(req: ForecastRequest<{ limit?: string }>, reply: FastifyReply) {
    try {
      const user = req.user;
      const { limit } = req.query as { limit?: string };

      if (!user) {
        return reply.status(401).send({
          success: false,
          error: 'Usuario no autenticado'
        });
      }

      req.log.info(`[FORECAST DRILLDOWN] Getting saved scenarios for user: ${user.user_id}`);

      const app = req.server;
      const scenarios = await ForecastingQueries.getSavedScenarios(
        app,
        user.user_id ?? 0,
        limit ? parseInt(limit) : 10
      );

      reply.send({
        success: true,
        data: {
          scenarios,
          count: scenarios.length
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[FORECAST DRILLDOWN] Error getting saved scenarios:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener escenarios guardados',
        details: getErrorMessage(error)
      });
    }
  }
}