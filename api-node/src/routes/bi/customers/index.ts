import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermissions } from '../../../middleware/auth';
import { CustomerAnalyticsService } from './customer-analytics.service';
import { CLVService } from './clv.service';
import { RFMMatrixService } from './rfm-matrix.service';
import { ChurnRiskService } from './churn-risk.service';

export async function customerRoutes(app: FastifyInstance) {
  // Authentication is handled by parent route context in bi/index.ts
  // No need to add hook here as it would cause double authentication
  
  // Get customer segments
  app.get('/segments', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const segments = await CustomerAnalyticsService.getCustomerSegments(app);
      return reply.send({
        success: true,
        data: segments
      });
    } catch (error) {
      app.log.error(error as Error, 'Segments error');
      return reply.status(500).send({
        success: false,
        error: 'Error al obtener segmentos de clientes'
      });
    }
  });

  // Get CLV distribution
  app.get('/clv-distribution', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const distribution = await CLVService.getCLVDistribution(app);
      return reply.send({
        success: true,
        data: distribution
      });
    } catch (error) {
      app.log.error(error as Error, 'CLV distribution error');
      return reply.status(500).send({
        success: false,
        error: 'Error al obtener distribución de CLV'
      });
    }
  });

  // Get CLV prediction for specific customer
  app.get('/clv-prediction/:clientId', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { clientId } = request.params as { clientId: string };

    try {
      const prediction = await CLVService.predictCLV(app, Number(clientId));
      return reply.send({
        success: true,
        data: prediction
      });
    } catch (error) {
      app.log.error(error as Error, 'CLV prediction error');
      return reply.status(500).send({
        success: false,
        error: 'Error al predecir CLV'
      });
    }
  });

  // Get RFM matrix
  app.get('/rfm-matrix', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const matrix = await RFMMatrixService.getRFMMatrix(app);
      return reply.send({
        success: true,
        data: matrix
      });
    } catch (error) {
      app.log.error(error as Error, 'RFM matrix error');
      return reply.status(500).send({
        success: false,
        error: 'Error al obtener matriz RFM'
      });
    }
  });

  // Get churn risk analysis
  app.get('/churn-risk', {
    preHandler: [requirePermissions('dashboard:read')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const churnRisk = await ChurnRiskService.getChurnRiskAnalysis(app);
      return reply.send({
        success: true,
        data: churnRisk
      });
    } catch (error) {
      app.log.error(error as Error, 'Churn risk error');
      return reply.status(500).send({
        success: false,
        error: 'Error al obtener análisis de riesgo de abandono'
      });
    }
  });

  // Calculate/recalculate RFM scores
  app.post('/calculate-rfm', {
    preHandler: [requirePermissions('dashboard:write')],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await CustomerAnalyticsService.calculateRFMScores(app);
      return reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      app.log.error(error as Error, 'Calculate RFM error');
      return reply.status(500).send({
        success: false,
        error: 'Error al calcular puntuaciones RFM'
      });
    }
  });
}