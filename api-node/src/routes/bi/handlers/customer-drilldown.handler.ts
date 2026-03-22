import { FastifyRequest, FastifyReply } from 'fastify';
import { CustomerQueries } from '../queries/customer.queries';

interface CustomerDrilldownQuery {
  segment?: string;
  limit?: string;
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class CustomerDrilldownHandler {
  /**
   * POST /v1/bi/customers/calculate-rfm
   * Calculate/recalculate RFM scores for all customers
   */
  static async calculateRFM(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[CUSTOMER DRILLDOWN] Calculating RFM scores for all customers');

      const app = req.server;
      await CustomerQueries.calculateRFMScores(app);

      reply.send({
        success: true,
        message: 'Puntuaciones RFM calculadas exitosamente'
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error calculating RFM:');
      reply.status(500).send({
        success: false,
        error: 'Error al calcular puntuaciones RFM',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/segments
   * Get customer segmentation overview
   */
  static async getSegments(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[CUSTOMER DRILLDOWN] Getting segment distribution');

      const app = req.server;
      const segments = await CustomerQueries.getSegmentDistribution(app);

      reply.send({
        success: true,
        data: {
          segments,
          total_segments: segments.length
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting segments:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener segmentos de clientes',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/rfm-matrix
   * Get RFM matrix for heatmap visualization
   */
  static async getRFMMatrix(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[CUSTOMER DRILLDOWN] Getting RFM matrix');

      const app = req.server;
      const matrix = await CustomerQueries.getRFMMatrix(app);

      reply.send({
        success: true,
        data: {
          matrix,
          dimensions: {
            recency: [1, 2, 3, 4, 5],
            frequency: [1, 2, 3, 4, 5]
          }
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting RFM matrix:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener matriz RFM',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/cohort-analysis
   * Get cohort retention analysis
   */
  static async getCohortAnalysis(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { months } = req.query as { months?: string };
      const monthsParam = months ? parseInt(months) : 12;

      req.log.info(`[CUSTOMER DRILLDOWN] Getting cohort analysis for ${monthsParam} months`);

      const app = req.server;
      const cohorts = await CustomerQueries.getCohortAnalysis(app, monthsParam);

      reply.send({
        success: true,
        data: {
          cohorts,
          months_analyzed: monthsParam
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting cohort analysis:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener análisis de cohortes',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/clv-distribution
   * Get customer lifetime value distribution
   */
  static async getCLVDistribution(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[CUSTOMER DRILLDOWN] Getting CLV distribution');

      const app = req.server;
      const distribution = await CustomerQueries.getCLVDistribution(app);

      reply.send({
        success: true,
        data: {
          distribution,
          total_buckets: distribution.length
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting CLV distribution:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener distribución de CLV',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/top-by-segment
   * Get top customers by segment
   */
  static async getTopBySegment(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { segment, limit } = req.query as CustomerDrilldownQuery;

      if (!segment) {
        return reply.status(400).send({
          success: false,
          error: 'Se requiere el parámetro segment'
        });
      }

      const resultLimit = limit ? parseInt(limit) : 10;

      req.log.info({ segment }, '[CUSTOMER DRILLDOWN] Getting top customers for segment:');

      const app = req.server;
      const customers = await CustomerQueries.getTopCustomersBySegment(app, segment, resultLimit);

      reply.send({
        success: true,
        data: {
          segment,
          customers,
          count: customers.length
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting top customers by segment:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener clientes principales',
        details: getErrorMessage(error)
      });
    }
  }

  /**
   * GET /v1/bi/customers/churn-risk
   * Get churn risk analysis
   */
  static async getChurnRisk(req: FastifyRequest, reply: FastifyReply) {
    try {
      req.log.info('[CUSTOMER DRILLDOWN] Getting churn risk analysis');

      const app = req.server;
      const analysis = await CustomerQueries.getChurnRiskAnalysis(app);

      reply.send({
        success: true,
        data: {
          risk_levels: analysis,
          total_levels: analysis.length
        }
      });

    } catch (error: unknown) {
      req.log.error({ err: error }, '[CUSTOMER DRILLDOWN] Error getting churn risk:');
      reply.status(500).send({
        success: false,
        error: 'Error al obtener análisis de riesgo de abandono',
        details: getErrorMessage(error)
      });
    }
  }
}