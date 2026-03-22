import type { AppWithPrisma, FeedbackData } from '../types';
import { FastifyRequest, FastifyReply } from 'fastify';
import { successResponse, errorResponseFromError } from '../../../utils/responses';
import { RateLimiterService } from '../services/rate-limiter.service';
import { validateFeedbackData } from '../utils/validators';
import { QueryBuilder } from '../utils/query-builder';

type FeedbackPayload = FeedbackData;

interface InsertFeedbackPayload extends FeedbackData {
  userId: number;
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class FeedbackHandler {
  static async submitFeedback(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      const payload = request.body as FeedbackPayload;

      request.log.info(
        `[FEEDBACK HANDLER] Submitting feedback for entity: ${payload.entityType}:${payload.entityId}, type: ${payload.feedbackType}`
      );

      const validatedData = validateFeedbackData(payload as Parameters<typeof validateFeedbackData>[0]);

      RateLimiterService.checkRateLimit(request.user!.id);

      await this.ensureFeedbackTable(request.server);

      await this.insertFeedback(request.server, {
        ...validatedData,
        userId: request.user!.id
      });

      request.log.info(
        `[FEEDBACK HANDLER] Successfully submitted feedback for entity: ${validatedData.entityType}:${validatedData.entityId}`
      );

      return successResponse(reply, {
        message: 'Feedback recorded for model improvement',
        entityType: validatedData.entityType,
        entityId: validatedData.entityId,
        feedbackType: validatedData.feedbackType
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, '[FEEDBACK HANDLER] Error submitting feedback:');
      return errorResponseFromError(reply, new Error(getErrorMessage(error)));
    }
  }

  private static async ensureFeedbackTable(app: AppWithPrisma): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER NOT NULL,
        feedback_type VARCHAR(50) NOT NULL,
        value JSONB,
        reason TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    const createIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_entity 
      ON ai_feedback(entity_type, entity_id)
    `;

    const createUserIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_ai_feedback_user 
      ON ai_feedback(user_id)
    `;

    try {
      await Promise.all([
        QueryBuilder.executeWithDebug<void>(
          app.prisma,
          createTableQuery,
          [],
          'FeedbackHandler.ensureFeedbackTable'
        ),
        QueryBuilder.executeWithDebug<void>(
          app.prisma,
          createIndexQuery,
          [],
          'FeedbackHandler.createEntityIndex'
        ),
        QueryBuilder.executeWithDebug<void>(
          app.prisma,
          createUserIndexQuery,
          [],
          'FeedbackHandler.createUserIndex'
        )
      ]);

      app.log.info('[FEEDBACK HANDLER] Feedback table and indexes ensured');
    } catch (error: unknown) {
      app.log.error({ err: error }, '[FEEDBACK HANDLER] Error ensuring feedback table:');
      throw new Error(getErrorMessage(error));
    }
  }

  private static async insertFeedback(app: AppWithPrisma, feedback: InsertFeedbackPayload): Promise<void> {
    const insertQuery = `
      INSERT INTO ai_feedback 
      (entity_type, entity_id, feedback_type, value, reason, user_id, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `;

    try {
      await QueryBuilder.executeWithDebug<void>(
        app.prisma,
        insertQuery,
        [
          feedback.entityType,
          feedback.entityId,
          feedback.feedbackType,
          JSON.stringify(feedback.value),
          feedback.reason,
          feedback.userId
        ],
        'FeedbackHandler.insertFeedback'
      );

      app.log.info(
        `[FEEDBACK HANDLER] Feedback inserted successfully for entity: ${feedback.entityType}:${feedback.entityId}`
      );
    } catch (error: unknown) {
      app.log.error({ err: error }, '[FEEDBACK HANDLER] Error inserting feedback:');
      throw new Error(getErrorMessage(error));
    }
  }
}
