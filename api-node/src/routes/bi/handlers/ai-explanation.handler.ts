import { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse, errorResponseFromError } from '../../../utils/responses';
import { RateLimiterService } from '../services/rate-limiter.service';
import { ForecastingQueries } from '../queries/forecasting.queries';

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class AIExplanationHandler {
  static async getAIExplanation(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };

      request.log.info(`[AI EXPLANATION HANDLER] Getting AI explanation for ID: ${id}`);

      const recommendationId = Number(id);
      if (!Number.isInteger(recommendationId) || recommendationId < 1) {
        return errorResponseFromError(reply, new Error('Invalid recommendation ID'), 400);
      }

      if (!request.user?.id) {
        return errorResponseFromError(reply, new Error('Unauthorized'), 401);
      }

      RateLimiterService.checkRateLimit(request.user.id);

      const explanation = await ForecastingQueries.getAIExplanation(
        request.server,
        recommendationId
      );

      if (!explanation) {
        request.log.warn(`[AI EXPLANATION HANDLER] No explanation found for ID: ${id}`);
        return errorResponseFromError(reply, new Error('Recommendation not found'), 404);
      }

      request.log.info(`[AI EXPLANATION HANDLER] Successfully retrieved AI explanation for ID: ${id}`);
      return successResponse(reply, explanation);
    } catch (error: unknown) {
      request.log.error({ err: error }, '[AI EXPLANATION HANDLER] Error getting AI explanation:');
      return errorResponseFromError(reply, new Error(getErrorMessage(error)));
    }
  }
}
